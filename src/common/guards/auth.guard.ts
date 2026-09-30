import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { session?: any }>();
    if (!req.session?.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
