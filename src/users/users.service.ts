import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateUserDto } from '../common/dto/common.dto';
import { CouchDbService, UserRecord } from '../common/couchdb.service';
import { UserRole } from '../common/roles';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  // Nest provides one UsersService per application. Serialize the entire status
  // transaction, including fresh actor validation, across all target accounts.
  private statusQueue: Promise<void> = Promise.resolve();
  constructor(private readonly couchDbService: CouchDbService) {}

  async createUser(dto: CreateUserDto): Promise<UserRecord> {
    const existing = await this.couchDbService.findUserByUsername(dto.username);
    if (existing) {
      throw new BadRequestException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const userDoc: Omit<UserRecord, '_id' | 'createdAt' | 'updatedAt'> = {
      type: 'user',
      username: dto.username,
      email: dto.email,
      passwordHash,
      role: dto.role,
      isActive: true,
    };

    return this.couchDbService.createUser(userDoc);
  }

  async listUsers() {
    return this.couchDbService.listUsers();
  }

  async findByUsername(username: string) {
    return this.couchDbService.findUserByUsername(username);
  }

  async findById(id: string) {
    return this.couchDbService.findUserById(id);
  }

  private async requireAdministrator(actingAdminId?: string) {
    const actor = actingAdminId ? await this.findById(actingAdminId) : null;
    if (!actor?.isActive || actor.role !== UserRole.ADMIN) throw new ForbiddenException('An active administrator is required');
    return actor;
  }

  async managementUsers(actingAdminId: string) {
    const actor = await this.requireAdministrator(actingAdminId);
    const users = await this.listUsers();
    const activeAdmins = users.filter(u => u.isActive && u.role === UserRole.ADMIN).length;
    return users.map(u => ({ _id: u._id, username: u.username, email: u.email, role: u.role, isActive: u.isActive,
      isSelf: u._id === actor._id,
      isLastActiveAdmin: u.isActive && u.role === UserRole.ADMIN && activeAdmins === 1,
      canDisable: u.isActive && u._id !== actor._id && (u.role !== UserRole.ADMIN || activeAdmins > 1) }));
  }

  private async validateStatusChange(userId: string, isActive: boolean, actingAdminId?: string) {
    if (typeof isActive !== 'boolean') throw new BadRequestException('Account status must be a boolean');
    const actor = await this.requireAdministrator(actingAdminId);
    const user = await this.couchDbService.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!isActive && userId === actor._id) throw new ForbiddenException('You cannot disable your own account');
    if (!isActive && user.isActive && user.role === UserRole.ADMIN) {
      const activeAdmins = (await this.listUsers()).filter(u => u.isActive && u.role === UserRole.ADMIN);
      if (activeAdmins.length <= 1) throw new ConflictException('The last active administrator cannot be disabled');
    }
    return { actor, user };
  }

  async previewDisable(userId: string, actingAdminId: string) {
    return (await this.validateStatusChange(userId, false, actingAdminId)).user;
  }

  async setUserActive(userId: string, isActive: boolean, actingAdminId?: string, context: { ip?: string; userAgent?: string } = {}) {
    const previous = this.statusQueue;
    let release: () => void;
    this.statusQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      // Guard checks are insufficient: a competing request may disable this
      // actor after its guard ran but before it obtains the status lock.
      const { actor, user } = await this.validateStatusChange(userId, isActive, actingAdminId);
      if (user.isActive === isActive) return { user, changed: false };
      const next = { ...user, isActive, updatedAt: new Date().toISOString(),
        sessionVersion: (user.sessionVersion ?? 0) + (isActive ? 0 : 1) };
      let saved: UserRecord;
      try { saved = await this.couchDbService.saveUser(next); }
      catch { throw new ServiceUnavailableException('Unable to save the account status. Please try again when storage is available.'); }
      try {
        await this.couchDbService.logAudit(isActive ? 'user.enabled' : 'user.disabled', {
          targetUserId: saved._id, targetUsername: saved.username,
          previousStatus: user.isActive ? 'active' : 'disabled', newStatus: isActive ? 'active' : 'disabled',
          userAgent: context.userAgent?.slice(0, 256),
        }, actor._id, actor.username, context.ip);
      } catch {
        this.logger.error('Account status saved but account-status audit persistence failed');
        throw new ServiceUnavailableException('Account status changed, but its audit record could not be saved. Contact an operator; repeating the action will not recreate the missing audit record.');
      }
      return { user: saved, changed: true };
    } finally { release!(); }
  }

  async promoteToAdmin(userId: string) {
    const user = await this.couchDbService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.role = UserRole.ADMIN;
    user.updatedAt = new Date().toISOString();
    const updated = await this.couchDbService.saveUser(user);
    return updated;
  }

  async assertFirstAdmin(): Promise<UserRecord | null> {
    const users = await this.listUsers();
    if (users.length === 0) {
      return null;
    }
    return users.find((user) => user.role === UserRole.ADMIN) || null;
  }

  async seedAdmin(username: string, email: string, password: string) {
    const dto = plainToInstance(CreateUserDto, { username, email, password, role: UserRole.ADMIN });
    const errors = validateSync(dto);
    if (!username?.trim() || errors.length) {
      throw new BadRequestException('Admin bootstrap requires a username, a valid email, and a password of at least 8 characters including uppercase, lowercase, and a digit');
    }
    const existing = await this.couchDbService.findUserByUsername(username);
    if (existing) {
      if (existing.role !== UserRole.ADMIN) {
        throw new BadRequestException('Bootstrap username collision: existing account is not an administrator and was not modified');
      }
      if (!existing.isActive) throw new BadRequestException('Existing administrator is disabled; explicit recovery is required');
      return { ...existing, message: 'admin-already-present' };
    }

    const created = await this.createUser(dto);
    const verified = await this.couchDbService.findUserById(created._id!);
    if (!verified || verified.username !== username || verified.role !== UserRole.ADMIN || !verified.isActive) {
      throw new Error('Created administrator could not be verified in CouchDB');
    }
    return { ...verified, message: 'admin-created' };
  }
}
