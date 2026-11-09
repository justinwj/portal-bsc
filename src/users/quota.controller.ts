import { Body, Controller, Get, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { PortalSettingsDto, UserQuotaDto } from '../common/dto/common.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { UsersService } from './users.service';

@Controller('admin/settings')
@UseGuards(AuthGuard, AdminGuard)
export class QuotaController {
  constructor(private readonly users: UsersService) {}
  @Get()
  async page(@Req() req: Request & {session?:any}, @Res() res: Response) {
    try { return res.render('admin-settings', { title: 'Capacity and storage policy', user: req.session.user,
      settings: await this.users.administratorSettings(req.session.user.id), saved: req.query.saved === '1' }); }
    catch (error) { return this.failure(error, res); }
  }
  @Post()
  async settings(@Req() req: Request & {session?:any}, @Body() dto: PortalSettingsDto, @Res() res: Response) {
    try { await this.users.updatePortalSettings(dto, req.session.user.id, {ip:req.ip,userAgent:req.get('user-agent')});return res.redirect(303,'/admin/settings?saved=1'); }
    catch(error) {return this.failure(error,res);}
  }
  @Post('users/:id/quota')
  async override(@Req() req: Request & {session?:any}, @Param('id') id: string, @Body() dto: UserQuotaDto, @Res() res: Response) {
    try {await this.users.updateUserQuota(id,dto.quotaGb,req.session.user.id,{ip:req.ip,userAgent:req.get('user-agent')});return res.redirect(303,'/admin/settings?saved=1');}
    catch(error) {return this.failure(error,res);}
  }
  private failure(error: unknown,res: Response) {
    if (!(error instanceof HttpException)) throw error;
    return res.status(error.getStatus()).render('workflow-error',{title:'Settings request not completed',error:error.message,returnPath:'/admin/settings'});
  }
}
