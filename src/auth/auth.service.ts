import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRecord } from '../common/couchdb.service';
import { LoginDto } from '../common/dto/common.dto';
import { UserRole } from '../common/roles';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async validateUser(dto: LoginDto): Promise<UserRecord | null> {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user || !user.isActive) {
      return null;
    }
    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      return null;
    }
    return user;
  }

  async buildSessionUser(user: UserRecord) {
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role ?? UserRole.MEMBER,
    };
  }
}
