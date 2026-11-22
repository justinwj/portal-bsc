import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { isAccessibleAccount } from '../account-state';
const browserPage = 'portal:browser-page';
export const BrowserPage = () => SetMetadata(browserPage, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  private unauthenticated(context: ExecutionContext, req: Request, message: string): false {
    if (Reflect.getMetadata(browserPage, context.getHandler()) && ['GET','HEAD'].includes(req.method)
      && /\btext\/html\b/i.test(req.get('accept') || '') && req.accepts(['html','json']) === 'html'
      && req.get('x-requested-with')?.toLowerCase() !== 'xmlhttprequest') {
      context.switchToHttp().getResponse().redirect(302, '/login');
      return false;
    }
    throw new UnauthorizedException(message);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { session?: any }>();
    const sessionUser = req.session?.user;

    if (!sessionUser) {
      return this.unauthenticated(context, req, 'Authentication required');
    }

    const user = await this.usersService.findById(sessionUser.id);
    if (!isAccessibleAccount(user) || (user.sessionVersion ?? 0) !== (sessionUser.sessionVersion ?? 0)) {
      if (req.session) {
        req.session.destroy(() => undefined);
      }
      return this.unauthenticated(context, req, 'Account is disabled, unavailable, or requires a new login');
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion ?? 0,
    };

    return true;
  }
}
