import { Body, Controller, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ManagedStorage } from './managed-storage.service';
import { UploadIntentDto, UploadPolicyDto } from './upload.dto';

@Controller()
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly storage:ManagedStorage){}
  @Get('uploads')
  page(@Req() req:Request&{session?:any},@Res() res:Response){return res.render('uploads',{title:'Upload a file',user:req.session.user,extensions:this.storage.extensions});}
  @Post('uploads/intents')
  intent(@Req() req:Request&{session?:any},@Body() dto:UploadIntentDto){return this.storage.reserve(dto,req);}
  @Put('uploads/:id/content')
  content(@Param('id') id:string,@Req() req:Request&{session?:any}){return this.storage.receive(id,req);}
  @Get('uploads/:id')
  status(@Param('id') id:string,@Req() req:Request&{session?:any}){return this.storage.status(id,req.session.user.id);}
  @Get('admin/settings/uploads')
  @UseGuards(AdminGuard)
  async settings(@Req() req:Request&{session?:any},@Res() res:Response){return res.render('upload-settings',{title:'Managed storage policy',user:req.session.user,policy:await this.storage.settings(req.session.user.id)});}
  @Post('admin/settings/uploads')
  @UseGuards(AdminGuard)
  async configure(@Req() req:Request&{session?:any},@Body() dto:UploadPolicyDto,@Res() res:Response){await this.storage.configure(dto,req.session.user.id,{ip:req.ip});return res.redirect(303,'/admin/settings/uploads');}
}
