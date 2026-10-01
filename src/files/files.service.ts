import { Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream, existsSync, promises as fs } from 'fs';
import { basename, resolve } from 'path';
import { CouchDbService, FileRecord } from '../common/couchdb.service';
import { SessionUser, UserRole } from '../common/roles';

@Injectable()
export class FilesService {
  constructor(private readonly couchDbService: CouchDbService) {}

  async listFilesForUser(user: SessionUser) {
    const files = await this.couchDbService.listFiles();
    return files.filter((file) => {
      const allowed = file.allowedRoles && file.allowedRoles.length > 0 ? file.allowedRoles : [UserRole.ADMIN, UserRole.MEMBER];
      return file.visibility === 'public' || allowed.includes(user.role);
    });
  }

  async listAllFiles() {
    return this.couchDbService.listFiles();
  }

  async getById(id: string) {
    return this.couchDbService.findFileById(id);
  }

  async createSeedFile(metadata: Partial<FileRecord> & { title: string; storedFilename: string; originalFilename: string; mimeType: string; sizeBytes: number; sha256: string; }) {
    const record: Omit<FileRecord, '_id' | 'createdAt' | 'updatedAt'> = {
      type: 'file',
      title: metadata.title,
      description: metadata.description || 'Internal portal file',
      storedFilename: metadata.storedFilename,
      originalFilename: metadata.originalFilename,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
      category: metadata.category || 'general',
      visibility: metadata.visibility || 'private',
      allowedRoles: metadata.allowedRoles || [UserRole.MEMBER, UserRole.ADMIN],
      uploadedByUserId: metadata.uploadedByUserId || 'seed',
    };
    return this.couchDbService.createFile(record);
  }

  async getFileForDownload(fileId: string, user: SessionUser) {
    const file = await this.couchDbService.findFileById(fileId);
    if (!file) {
      throw new NotFoundException('File not found');
    }
    const allowedRoles = file.allowedRoles && file.allowedRoles.length > 0 ? file.allowedRoles : [UserRole.MEMBER, UserRole.ADMIN];
    if (file.visibility === 'public' || allowedRoles.includes(user.role)) {
      return file;
    }
    throw new NotFoundException('File not available to your role');
  }

  getSecureFilePath(file: FileRecord) {
    const root = resolve(process.env.NAS_FILES_DIR || './data/files');
    const safeName = basename(file.storedFilename);
    const target = resolve(root, safeName);
    if (!target.startsWith(root)) {
      throw new Error('File path is invalid');
    }
    return target;
  }

  async readFileStream(file: FileRecord) {
    const target = this.getSecureFilePath(file);
    if (!existsSync(target)) {
      throw new NotFoundException('Stored file not found on the NAS');
    }
    const stat = await fs.stat(target);
    return { stream: createReadStream(target), size: stat.size };
  }
}
