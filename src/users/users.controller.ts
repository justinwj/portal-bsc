import { BadRequestException, Body, Controller, Get, Param, Post, Redirect, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthGuard } from '../common/guards/auth.guard';
import { CreateUserDto } from '../common/dto/common.dto';
import { UserRole } from '../common/roles';
import { UsersService } from './users.service';

@Controller('admin')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  async usersPage(@Req() req: Request & { session?: any }, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin access required');
    }
    const users = await this.usersService.listUsers();
    return res.render('admin-users', { title: 'User management', users, user: req.session.user, csrfToken: req.csrfToken ? req.csrfToken() : '' });
  }

  @Post('users')
  async createUser(@Req() req: Request & { session?: any }, @Body() body: any, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin access required');
    }

    const dto = plainToInstance(CreateUserDto, body);
    const errors = await validate(dto);
    if (errors.length > 0) {
      throw new BadRequestException('Validation failed');
    }

    await this.usersService.createUser(dto);
    return res.redirect('/admin/users');
  }

  @Post('users/:id/disable')
  async disableUser(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    if (req.session.user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Admin access required');
    }
    await this.usersService.setUserActive(id, false);
    return res.redirect('/admin/users');
  }
}
