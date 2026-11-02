import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { constants, promises as fs, ReadStream } from 'fs';
import { FileHandle } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { CouchDbService, FileRecord } from '../common/couchdb.service';
import { SessionUser, UserRole } from '../common/roles';

@Injectable()
export class FilesService {
  private storageRoot?: string;
  constructor(private readonly couchDbService: CouchDbService) {}

  async listFilesForUser(user: SessionUser) {
    const files = await this.couchDbService.listFiles();
    return files.filter((file) => {
      const allowed = Array.isArray(file.allowedRoles) && file.allowedRoles.length > 0 ? file.allowedRoles : [];
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

    if (file.visibility === 'public') {
      return file;
    }

    const allowedRoles = Array.isArray(file.allowedRoles) ? file.allowedRoles : [];
    if (allowedRoles.length === 0 || !allowedRoles.includes(user.role)) {
      throw new NotFoundException('File not available to your role');
    }

    return file;
  }

  getSecureFilePath(file: FileRecord) {
    const name = file.storedFilename;
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.trim() !== name
      || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name) || /[. ]$/.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      throw new NotFoundException('Stored file not available');
    }
    return resolve(this.storageRoot ?? process.env.NAS_FILES_DIR ?? './data/files', name);
  }

  private async validateStorageRoot() {
    const configured = process.env.NAS_FILES_DIR;
    if (process.env.NODE_ENV === 'production' && (!configured || !isAbsolute(configured))) {
      throw new Error('NAS_FILES_DIR must be an explicit absolute directory in production');
    }
    try {
      const root = await fs.realpath(resolve(configured || './data/files'));
      if (!(await fs.stat(root)).isDirectory()) throw new Error('Not a directory');
      await fs.access(root, constants.R_OK | constants.X_OK);
      return root;
    } catch {
      throw new Error('NAS_FILES_DIR must identify an existing readable and searchable directory');
    }
  }

  async initializeStorage() {
    if (process.env.NODE_ENV !== 'production') {
      await fs.mkdir(resolve(process.env.NAS_FILES_DIR || './data/files'), { recursive: true });
    }
    this.storageRoot = await this.validateStorageRoot();
  }

  async readFileStream(file: FileRecord) {
    let handle: FileHandle | undefined;
    let stream: ReadStream | undefined;
    try {
      // Validate the literal name before performing filesystem operations.
      this.getSecureFilePath(file);
      this.storageRoot ??= await this.validateStorageRoot();
      const target = this.getSecureFilePath(file);
      const entry = await fs.lstat(target, { bigint: true });
      if (!entry.isFile() || entry.isSymbolicLink()) throw new NotFoundException('Stored file not available');
      const canonical = await fs.realpath(target);
      const suffix = relative(this.storageRoot, canonical);
      if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
        throw new NotFoundException('Stored file not available');
      }
      handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
        throw new NotFoundException('Stored file not available');
      }
      const finalPath = await fs.realpath(target);
      if (finalPath !== canonical) throw new NotFoundException('Stored file not available');
      const size = Number(opened.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('Unsupported file size');
      stream = handle.createReadStream({ autoClose: true, ...(size ? { end: size - 1 } : {}) });
      // Keep an error listener installed until the HTTP pipeline takes ownership.
      stream.on('error', () => undefined);
      await new Promise<void>((resolveReady, reject) => {
        const cleanup = () => { stream!.off('readable', ready); stream!.off('end', ready); stream!.off('error', failed); };
        const ready = () => { cleanup(); resolveReady(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        stream!.once('readable', ready);
        stream!.once('end', ready);
        stream!.once('error', failed);
      });
      return { stream, size };
    } catch (error: any) {
      if (stream) stream.destroy();
      else await handle?.close();
      if (error instanceof NotFoundException) throw error;
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error?.code)) {
        throw new NotFoundException('Stored file not available');
      }
      throw new InternalServerErrorException('Unable to read requested file');
    }
  }
}
