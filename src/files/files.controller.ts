import { Controller, Get, InternalServerErrorException, Logger, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { FilesService } from './files.service';

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  private readonly logger = new Logger(FilesController.name);
  constructor(
    private readonly filesService: FilesService,
    private readonly auditService: AuditService,
  ) {}

  @Get('download/:id')
  async download(@Req() req: Request & { session?: any }, @Param('id') id: string, @Res() res: Response) {
    const allowedFile = await this.filesService.getFileForDownload(id, req.session.user);
    const fileStream = await this.filesService.readFileStream(allowedFile);

    try {
      res.setHeader('Content-Type', allowedFile.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', String(fileStream.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(allowedFile.originalFilename || allowedFile.title)}"`);
      const managed=allowedFile.schemaVersion===2,hash=managed?createHash('sha256'):undefined;
      if(managed){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');}
      let transferred = 0;
      const exactLength = new Transform({
        transform(chunk, _encoding, callback) { transferred += chunk.length;hash?.update(chunk);callback(null, chunk); },
        flush(callback) { callback(transferred === fileStream.size&&(!hash||hash.digest('hex')===allowedFile.sha256) ? undefined : new Error('Incomplete or corrupt file transfer')); },
      });
      await pipeline(fileStream.stream, exactLength, res);
    } catch {
      fileStream.stream.destroy();
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy();
        return;
      }
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
      throw new InternalServerErrorException('Unable to download requested file');
    }
    // A download event denotes a completed server transfer, not merely an attempt.
    try {
      await this.auditService.logDownload(req.session.user.id, allowedFile._id, allowedFile.title, req.ip);
    } catch (error) {
      this.logger.error('Completed download audit could not be persisted', error instanceof Error ? error.stack : undefined);
    }
  }
}
