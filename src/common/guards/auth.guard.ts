import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { session?: any }>();
    const sessionUser = req.session?.user;

    if (!sessionUser) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.usersService.findById(sessionUser.id);
    if (!user || !user.isActive) {
      if (req.session) {
        req.session.destroy(() => undefined);
      }
      throw new UnauthorizedException('Account is disabled or unavailable');
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    return true;
  }
}
