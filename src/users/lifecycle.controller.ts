import { BadRequestException, Body, Controller, Get, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccountStatusDto, RegistrationDto } from '../common/dto/common.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { UsersService } from './users.service';

type SessionRequest = Request & { session?: any };
const context = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

@Controller()
export class LifecycleController {
  constructor(private readonly users: UsersService) {}

  @Get('register')
  registrationPage(@Req() req: Request, @Res() res: Response) {
    return res.render('register', { title: 'Register', submitted: req.query.submitted === '1' });
  }

  @Post('register')
  async register(@Req() req: Request, @Body() dto: RegistrationDto, @Res() res: Response) {
    try {
      await this.users.register(dto, context(req));
      return res.redirect(303, '/register?submitted=1');
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return res.status(error.getStatus()).render('register', { title: 'Register', error: error.getStatus() >= 500
        ? 'Registration is temporarily unavailable. Please try again later.' : 'Check the registration requirements and try again.' });
    }
  }

  @Get('account')
  @UseGuards(AuthGuard)
  async account(@Req() req: SessionRequest, @Res() res: Response) {
    return res.render('account', { title: 'Account settings', user: req.session.user, account: await this.users.accountSettings(req.session.user.id) });
  }

  @Post('account/deletion-request')
  @UseGuards(AuthGuard)
  async requestDeletion(@Req() req: SessionRequest, @Body() dto: AccountStatusDto, @Res() res: Response) {
    try {
      if (dto.confirmed !== 'yes') throw new BadRequestException('Confirm that you want to request account closure');
      await this.users.requestDeletion(req.session.user.id, context(req));
      return res.redirect(303, '/account');
    } catch (error) { return this.failure(error, res, '/account'); }
  }

  @Post('admin/users/:id/registration/:decision')
  @UseGuards(AuthGuard, AdminGuard)
  async registrationDecision(@Req() req: SessionRequest, @Param('id') id: string, @Param('decision') decision: string,
    @Body() _dto: AccountStatusDto, @Res() res: Response) {
    try {
      await this.users.decideRegistration(id, decision, req.session.user.id, context(req));
      return res.redirect(303, '/admin/users?notice=registration-decided');
    } catch (error) { return this.failure(error, res, '/admin/users'); }
  }

  @Post('admin/users/:id/deletion/:requestId/:decision')
  @UseGuards(AuthGuard, AdminGuard)
  async deletionDecision(@Req() req: SessionRequest, @Param('id') id: string, @Param('requestId') requestId: string,
    @Param('decision') decision: string, @Body() dto: AccountStatusDto, @Res() res: Response) {
    try {
      if (decision === 'approve' && dto.confirmed !== 'yes') throw new BadRequestException('Confirm account closure; all records and files will be retained');
      await this.users.decideDeletion(id, requestId, decision, req.session.user.id, context(req));
      return res.redirect(303, '/admin/users?notice=deletion-decided');
    } catch (error) { return this.failure(error, res, '/admin/users'); }
  }

  @Get('admin/users/:id/history')
  @UseGuards(AuthGuard, AdminGuard)
  async history(@Req() req: SessionRequest, @Param('id') id: string, @Res() res: Response) {
    return res.render('account-history', { title: 'Account audit history', user: req.session.user,
      account: await this.users.accountHistory(id, req.session.user.id) });
  }

  private failure(error: unknown, res: Response, returnPath: string) {
    if (!(error instanceof HttpException)) throw error;
    return res.status(error.getStatus()).render('workflow-error', { title: 'Request not completed', error: error.message, returnPath });
  }
}
