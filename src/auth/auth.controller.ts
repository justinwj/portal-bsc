import { BadRequestException, Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
      csrfToken: req.csrfToken ? req.csrfToken() : '',
    });
  }

  @Post('login')
  async login(@Req() req: Request & { session?: any }, @Body() body: any, @Res() res: Response) {
    const dto = plainToInstance(LoginDto, body);
    const errors = await validate(dto);
    if (errors.length > 0) {
      await this.auditService.logLoginFailure(body.username || 'unknown', req.ip, 'validation');
      return res.redirect('/login?error=invalid');
    }

    const user = await this.authService.validateUser(dto);
    if (!user) {
      await this.auditService.logLoginFailure(dto.username, req.ip, 'credentials');
      return res.redirect('/login?error=invalid');
    }

    req.session.user = await this.authService.buildSessionUser(user);
    await this.auditService.logLoginSuccess(user._id, user.username, req.ip);
    return res.redirect('/');
  }

  @Get('logout')
  async logout(@Req() req: Request & { session?: any }, @Res() res: Response) {
    req.session.destroy(() => undefined);
    return res.redirect('/login');
  }
}
