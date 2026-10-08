import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from '../common/dto/common.dto';
import { CouchDbService, UserRecord } from '../common/couchdb.service';
import { UserRole } from '../common/roles';

@Injectable()
export class UsersService {
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

  async setUserActive(userId: string, isActive: boolean) {
    const user = await this.couchDbService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.isActive = isActive;
    user.updatedAt = new Date().toISOString();
    const updated = await this.couchDbService.saveUser(user);
    return updated;
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
    const existing = await this.couchDbService.findUserByUsername(username);
    if (existing) {
      if (existing.role === UserRole.ADMIN) {
        return { ...existing, message: 'admin-already-present' };
      }

      const promoted = await this.promoteToAdmin(existing._id!);
      return { ...promoted, message: 'admin-promoted' };
    }

    const created = await this.createUser({
      username,
      email,
      password,
      role: UserRole.ADMIN,
    });
    return { ...created, message: 'admin-created' };
  }
}
