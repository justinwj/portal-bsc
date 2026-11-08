import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateUserDto, RegistrationDto } from '../common/dto/common.dto';
import { accountStatus, isAccessibleAccount } from '../common/account-state';
import { CouchDbService, UserRecord } from '../common/couchdb.service';
import { UserRole } from '../common/roles';

export interface AccountRequestContext { ip?: string; userAgent?: string }

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  // Nest provides one UsersService per application. Serialize the entire status
  // transaction, including fresh actor validation, across all target accounts.
  private statusQueue: Promise<void> = Promise.resolve();
  constructor(private readonly couchDbService: CouchDbService) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.statusQueue;
    let release: () => void;
    this.statusQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release!(); }
  }

  async createUser(dto: CreateUserDto): Promise<UserRecord> {
    return this.exclusive(() => this.createManagedUser(dto));
  }

  private async createManagedUser(dto: CreateUserDto): Promise<UserRecord> {
    const existing = (await this.listUsers()).find(u => u.username.trim().toLowerCase() === dto.username.trim().toLowerCase());
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
    if (!isAccessibleAccount(actor) || actor.role !== UserRole.ADMIN) throw new ForbiddenException('An active administrator is required');
    return actor;
  }

  async managementUsers(actingAdminId: string) {
    const actor = await this.requireAdministrator(actingAdminId);
    const users = await this.listUsers();
    const activeAdmins = users.filter(u => isAccessibleAccount(u) && u.role === UserRole.ADMIN).length;
    return users.map(u => ({ _id: u._id, username: u.username, email: u.email, role: u.role, isActive: u.isActive,
      accountStatus: accountStatus(u), registration: u.registration, deletionRequest: u.deletionRequests?.at(-1),
      canEnable: !u.isActive && !u.closedAt && (!u.registration || u.registration.status === 'approved'),
      isSelf: u._id === actor._id,
      isLastActiveAdmin: isAccessibleAccount(u) && u.role === UserRole.ADMIN && activeAdmins === 1,
      canDisable: isAccessibleAccount(u) && u._id !== actor._id && (u.role !== UserRole.ADMIN || activeAdmins > 1),
      canClose: u._id !== actor._id && !u.closedAt && !(isAccessibleAccount(u) && u.role === UserRole.ADMIN && activeAdmins === 1) }));
  }

  private async validateStatusChange(userId: string, isActive: boolean, actingAdminId?: string) {
    if (typeof isActive !== 'boolean') throw new BadRequestException('Account status must be a boolean');
    const actor = await this.requireAdministrator(actingAdminId);
    const user = await this.couchDbService.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (isActive && (user.closedAt || (user.registration && user.registration.status !== 'approved'))) {
      throw new ConflictException('Pending, rejected or closed accounts cannot be enabled through ordinary user management');
    }
    if (!isActive && userId === actor._id) throw new ForbiddenException('You cannot disable your own account');
    if (!isActive && user.isActive && user.role === UserRole.ADMIN) {
      const activeAdmins = (await this.listUsers()).filter(u => isAccessibleAccount(u) && u.role === UserRole.ADMIN);
      if (activeAdmins.length <= 1) throw new ConflictException('The last active administrator cannot be disabled');
    }
    return { actor, user };
  }

  async previewDisable(userId: string, actingAdminId: string) {
    return (await this.validateStatusChange(userId, false, actingAdminId)).user;
  }

  async setUserActive(userId: string, isActive: boolean, actingAdminId?: string, context: AccountRequestContext = {}) {
    return this.exclusive(async () => {
      // Guard checks are insufficient: a competing request may disable this
      // actor after its guard ran but before it obtains the status lock.
      const { actor, user } = await this.validateStatusChange(userId, isActive, actingAdminId);
      if (user.isActive === isActive) return { user, changed: false };
      const next = { ...user, isActive, updatedAt: new Date().toISOString(),
        // Rotate on enable too: a legacy disabled record may still have old
        // version-zero cookies that were never presented while disabled.
        sessionVersion: (user.sessionVersion ?? 0) + 1 };
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
    });
  }

  async register(dto: RegistrationDto, context: AccountRequestContext = {}) {
    const data = plainToInstance(RegistrationDto, dto);
    if (validateSync(data, { whitelist: true, forbidNonWhitelisted: true }).length || Buffer.byteLength(data.password, 'utf8') > 72) {
      throw new BadRequestException('Check the registration requirements');
    }
    // Hash all eligible submissions, including duplicates, before lookup. This
    // avoids an obvious cheap duplicate response path; HTTP attempts are limited.
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.exclusive(async () => {
      let user: UserRecord;
      try {
        const users = await this.listUsers();
        if (users.some(u => u.username.trim().toLowerCase() === data.username || u.email?.trim().toLowerCase() === data.email)) return;
        user = await this.couchDbService.createUser({ type: 'user', username: data.username, email: data.email, passwordHash,
          role: UserRole.MEMBER, isActive: false, registration: { status: 'pending', requestedAt: new Date().toISOString() } });
      } catch { throw new ServiceUnavailableException('Registration is temporarily unavailable'); }
      try { await this.workflowAudit('registration.requested', user, undefined, 'none', 'pending', context); }
      catch {
        // A generic public response must not disclose whether an identity exists.
        // The pending account is retained; operators receive an explicit warning.
        this.logger.error('Pending registration saved but registration audit persistence failed');
      }
    });
  }

  private validateDecision(decision: string) {
    if (decision !== 'approve' && decision !== 'reject') throw new BadRequestException('Decision must be approve or reject');
    return decision === 'approve' ? 'approved' as const : 'rejected' as const;
  }

  private async requireAccount(userId: string) {
    const user = await this.findById(userId);
    if (!isAccessibleAccount(user)) throw new ForbiddenException('An active approved account is required');
    return user;
  }

  private async workflowAudit(event: string, target: UserRecord, actor: UserRecord | undefined,
    previousStatus: string, newStatus: string, context: AccountRequestContext, requestId?: string) {
    return this.couchDbService.logAudit(event, { targetUserId: target._id, targetUsername: target.username,
      previousStatus, newStatus, requestId, userAgent: context.userAgent?.slice(0, 256) }, actor?._id, actor?.username, context.ip);
  }

  private async saveWorkflow(next: UserRecord, event: string, actor: UserRecord, previousStatus: string,
    newStatus: string, context: AccountRequestContext, requestId?: string) {
    let saved: UserRecord;
    try { saved = await this.couchDbService.saveUser(next); }
    catch { throw new ServiceUnavailableException('Unable to save the account change. Try again when storage is available.'); }
    try { await this.workflowAudit(event, saved, actor, previousStatus, newStatus, context, requestId); }
    catch {
      this.logger.error('Account workflow saved but workflow audit persistence failed');
      throw new ServiceUnavailableException('Account change saved, but its audit record could not be saved. Contact an operator; retrying will not recreate the missing event.');
    }
  }

  async decideRegistration(userId: string, decision: string, actingAdminId: string, context: AccountRequestContext = {}) {
    return this.exclusive(async () => {
      const state = this.validateDecision(decision), actor = await this.requireAdministrator(actingAdminId);
      const user = await this.findById(userId);
      if (!user) throw new NotFoundException('User not found');
      if (!user.registration || user.closedAt) throw new ConflictException('This account has no pending registration');
      if (user.registration.status === state) return;
      if (user.registration.status !== 'pending') throw new ConflictException('Registration already has a different decision');
      await this.saveWorkflow({ ...user, role: UserRole.MEMBER, isActive: state === 'approved', sessionVersion: (user.sessionVersion ?? 0) + 1,
        registration: { ...user.registration, status: state, decidedBy: actor._id, decidedAt: new Date().toISOString() } },
      `registration.${state}`, actor, 'pending', state, context);
    });
  }

  async accountSettings(userId: string) {
    const user = await this.requireAccount(userId);
    return { username: user.username, email: user.email, requests: [...(user.deletionRequests ?? [])].reverse(),
      pending: user.deletionRequests?.at(-1)?.status === 'pending' };
  }

  async requestDeletion(userId: string, context: AccountRequestContext = {}) {
    return this.exclusive(async () => {
      const user = await this.requireAccount(userId), previous = user.deletionRequests?.at(-1);
      if (previous?.status === 'pending') return;
      const request = { id: randomUUID(), status: 'pending' as const, requestedAt: new Date().toISOString() };
      await this.saveWorkflow({ ...user, deletionRequests: [...(user.deletionRequests ?? []), request] },
        'account.deletion_requested', user, previous?.status ?? 'none', 'pending', context, request.id);
    });
  }

  async decideDeletion(userId: string, requestId: string, decision: string, actingAdminId: string, context: AccountRequestContext = {}) {
    return this.exclusive(async () => {
      const state = this.validateDecision(decision), actor = await this.requireAdministrator(actingAdminId);
      const user = await this.findById(userId);
      if (!user) throw new NotFoundException('User not found');
      const request = user.deletionRequests?.at(-1);
      if (!request || request.id !== requestId) throw new ConflictException('Deletion request is missing or has been superseded');
      if (request.status === state) return;
      if (request.status !== 'pending') throw new ConflictException('Deletion request already has a different decision');
      if (state === 'approved') await this.validateStatusChange(userId, false, actingAdminId);
      const now = new Date().toISOString();
      const next = { ...user, deletionRequests: user.deletionRequests.map(r => r.id === requestId
        ? { ...r, status: state, decidedAt: now, decidedBy: actor._id } : r) };
      if (state === 'approved') { next.isActive = false; next.closedAt = now; next.sessionVersion = (user.sessionVersion ?? 0) + 1; }
      await this.saveWorkflow(next, state === 'approved' ? 'account.closed' : 'account.deletion_rejected', actor,
        'pending', state === 'approved' ? 'closed' : 'rejected', context, requestId);
    });
  }

  async accountHistory(userId: string, actingAdminId: string) {
    await this.requireAdministrator(actingAdminId);
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const events = await this.couchDbService.listUserAudits(userId);
    return { username: user.username, events: events.map(e => ({ event: e.event, actor: e.username ?? 'Public registration',
      createdAt: e.createdAt, previousStatus: e.details?.previousStatus, newStatus: e.details?.newStatus })) };
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
