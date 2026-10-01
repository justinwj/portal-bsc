import { Controller, Get, Param, Req, Res, UseGuards, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from './common/guards/auth.guard';
import { FilesService } from './files/files.service';

@Controller()
@UseGuards(AuthGuard)
export class AppController {
  constructor(private readonly filesService: FilesService) {}

  @Get('/')
  async dashboard(@Req() req: Request & { session?: any }, @Res() res: Response) {
    const files = await this.filesService.listFilesForUser(req.session.user);
    return res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      files,
    });
  }

  @Get('/files')
  async filesPage(@Req() req: Request & { session?: any }, @Res() res: Response) {
    const files = await this.filesService.listFilesForUser(req.session.user);
    return res.render('files', { title: 'Files', user: req.session.user, files, csrfToken: req.csrfToken() });
  }

  @Get('/files/:id')
  async fileDetail(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    const file = await this.filesService.getById(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }
    const visible = await this.filesService.getFileForDownload(id, req.session.user);
    return res.render('file-detail', { title: file.title, file: visible, user: req.session.user, csrfToken: req.csrfToken() });
  }
}
