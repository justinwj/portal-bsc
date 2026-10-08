import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from '../common/dto/common.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Get('login')
  loginPage(@Req() req: Request, @Res() res: Response) {
    return res.render('login', {
      title: 'Login',
      error: req.query.error ?? null,
      csrfToken: req.csrfToken(),
    });
  }

  @Post('login')
  async login(@Req() req: Request & { session?: any }, @Body() dto: LoginDto, @Res() res: Response) {
    const user = await this.authService.validateUser(dto);
    if (!user) {
      await this.auditService.logLoginFailure(dto.username, req.ip, 'credentials');
      return res.redirect('/login?error=invalid');
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    req.session.user = await this.authService.buildSessionUser(user);
    await new Promise<void>((resolve, reject) => {
      req.session.save((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    await this.auditService.logLoginSuccess(user._id, user.username, req.ip);
    return res.redirect('/');
  }

  @Post('logout')
  async logout(@Req() req: Request & { session?: any }, @Res() res: Response) {
    req.session.destroy((error: Error | null) => {
      res.clearCookie('connect.sid');
      if (error) {
        return res.redirect('/login?error=logout');
      }
      return res.redirect('/login');
    });
  }
}
