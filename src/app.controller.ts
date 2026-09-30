import { BadRequestException, Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from './common/guards/auth.guard';
import { FilesService } from './files/files.service';
import { UsersService } from './users/users.service';

@Controller()
@UseGuards(AuthGuard)
export class AppController {
  constructor(
    private readonly filesService: FilesService,
    private readonly usersService: UsersService,
  ) {}

  @Get('/')
  async dashboard(@Req() req: Request & { session?: any }, @Res() res: Response) {
    const files = await this.filesService.listFilesForUser(req.session.user.role, req.session.user.username);
    return res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      files,
    });
  }

  @Get('/files')
  async filesPage(@Req() req: Request & { session?: any }, @Res() res: Response) {
    const files = await this.filesService.listFilesForUser(req.session.user.role, req.session.user.username);
    return res.render('files', { title: 'Files', user: req.session.user, files, csrfToken: req.csrfToken ? req.csrfToken() : '' });
  }

  @Get('/files/:id')
  async fileDetail(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    const file = await this.filesService.getById(id);
    if (!file) {
      throw new BadRequestException('File not found');
    }
    const visible = await this.filesService.getFileForDownload(id, req.session.user.role);
    return res.render('file-detail', { title: file.title, file: visible, user: req.session.user });
  }
}
