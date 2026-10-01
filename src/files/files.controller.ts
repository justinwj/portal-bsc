import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { FilesService } from './files.service';

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly auditService: AuditService,
  ) {}

  @Get('download/:id')
  async download(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    const allowedFile = await this.filesService.getFileForDownload(id, req.session.user);
    const fileStream = await this.filesService.readFileStream(allowedFile);
    await this.auditService.logDownload(req.session.user.id, allowedFile._id, allowedFile.title, req.ip);

    res.setHeader('Content-Type', allowedFile.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(fileStream.size));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(allowedFile.originalFilename || allowedFile.title)}"`);
    return fileStream.stream.pipe(res);
  }
}
