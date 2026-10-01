import { Injectable } from '@nestjs/common';
import { CouchDbService } from '../common/couchdb.service';

@Injectable()
export class AuditService {
  constructor(private readonly couchDbService: CouchDbService) {}

  async logLoginSuccess(userId: string, username: string, ip?: string) {
    return this.couchDbService.logAudit('login.success', { username }, userId, username, ip);
  }

  async logLoginFailure(username: string, ip?: string, reason?: string) {
    return this.couchDbService.logAudit('login.failure', { reason }, undefined, username, ip);
  }

  async logDownload(userId: string, fileId: string, fileTitle: string, ip?: string) {
    await this.couchDbService.logDownload(userId, fileId, fileTitle);
    return this.couchDbService.logAudit('file.download', { fileId, fileTitle }, userId, undefined, ip);
  }
}
