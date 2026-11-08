import { BadRequestException, Body, Controller, Get, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccountStatusDto, CreateUserDto } from '../common/dto/common.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { AuthGuard } from '../common/guards/auth.guard';
import { UsersService } from './users.service';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  async usersPage(@Req() req: Request & { session?: any }, @Res() res: Response) {
    const notices = new Map([
      ['enabled', 'Account enabled. The user must sign in again.'],
      ['disabled', 'Account disabled. Existing sessions can no longer access protected pages.'],
      ['unchanged', 'Account status was already set; no change was made.'],
      ['registration-decided', 'Registration decision recorded. Repeated identical decisions make no further changes.'],
      ['deletion-decided', 'Deletion request decision recorded. Account records and associated files are retained.'],
    ]);
    return this.renderUsers(req, res, { notice: notices.get(String(req.query.notice)) });
  }

  private async renderUsers(req: Request & { session?: any }, res: Response, feedback: { notice?: string; error?: string } = {}) {
    // Revalidate before rendering even on a rejected operation. A concurrent
    // disable must not return administration data in its rejection page.
    const users = await this.usersService.managementUsers(req.session.user.id);
    return res.render('admin-users', { title: 'User management', user: req.session.user, users,
      pendingRegistrations: users.filter(u => u.registration?.status === 'pending'),
      pendingDeletions: users.filter(u => u.deletionRequest?.status === 'pending'), ...feedback });
  }

  @Post('users')
  async createUser(@Req() req: Request & { session?: any }, @Body() dto: CreateUserDto, @Res() res: Response) {
    await this.usersService.createUser(dto);
    return res.redirect('/admin/users');
  }

  @Get('users/:id/disable')
  async confirmDisable(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    try {
      const target = await this.usersService.previewDisable(id, req.session.user.id);
      return res.render('admin-disable', { title: 'Confirm account disable', target: { _id: target._id, username: target.username }, user: req.session.user });
    } catch (error) { return this.statusError(error, req, res); }
  }

  @Post('users/:id/disable')
  async disableUser(@Req() req: Request & { session?: any }, @Param('id') id: string, @Body() dto: AccountStatusDto, @Res() res: Response) {
    return this.changeStatus(req, res, id, false, dto);
  }

  @Post('users/:id/enable')
  async enableUser(@Req() req: Request & { session?: any }, @Param('id') id: string, @Body() dto: AccountStatusDto, @Res() res: Response) {
    return this.changeStatus(req, res, id, true, dto);
  }

  private async changeStatus(req: Request & { session?: any }, res: Response, id: string, active: boolean, dto: AccountStatusDto) {
    try {
      if (!active && dto.confirmed !== 'yes') throw new BadRequestException('Confirm the disable action before continuing.');
      const result = await this.usersService.setUserActive(id, active, req.session.user.id, { ip: req.ip, userAgent: req.get('user-agent') });
      return res.redirect(`/admin/users?notice=${result.changed ? active ? 'enabled' : 'disabled' : 'unchanged'}`);
    } catch (error) { return this.statusError(error, req, res); }
  }

  private async statusError(error: unknown, req: Request & { session?: any }, res: Response) {
    if (!(error instanceof HttpException)) throw error;
    res.status(error.getStatus());
    return this.renderUsers(req, res, { error: error.message });
  }
}
