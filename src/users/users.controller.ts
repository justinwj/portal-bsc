import { Body, Controller, ForbiddenException, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CreateUserDto } from '../common/dto/common.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { UserRole } from '../common/roles';
import { UsersService } from './users.service';

@Controller('admin')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  async usersPage(@Req() req: Request & { session?: any }, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    const users = await this.usersService.listUsers();
    return res.render('admin-users', { title: 'User management', users, user: req.session.user, csrfToken: req.csrfToken() });
  }

  @Post('users')
  async createUser(@Req() req: Request & { session?: any }, @Body() dto: CreateUserDto, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    await this.usersService.createUser(dto);
    return res.redirect('/admin/users');
  }

  @Post('users/:id/disable')
  async disableUser(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    await this.usersService.setUserActive(id, false);
    return res.redirect('/admin/users');
  }
}
