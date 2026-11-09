import { Injectable, InternalServerErrorException, NotFoundException, Optional } from '@nestjs/common';
import { constants, promises as fs, ReadStream } from 'fs';
import { FileHandle } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { CouchDbService, FileRecord } from '../common/couchdb.service';
import { SessionUser, UserRole } from '../common/roles';
import { ManagedStorage } from './managed-storage.service';
import { createHash } from 'node:crypto';

@Injectable()
export class FilesService {
  private storageRoot?: string;
  constructor(private readonly couchDbService: CouchDbService, @Optional() private readonly managed?:ManagedStorage) {}

  private isManaged(file:FileRecord){return file.schemaVersion!==undefined||file.accessModel!==undefined||file._id?.startsWith('upload-');}
  noteDownloadFailure(file:FileRecord){if(this.isManaged(file))this.managed?.invalidate();}
  private presented(file:FileRecord,user:SessionUser){return this.isManaged(file)?{...file,accessCategory:file.uploadedByUserId===user.id?(file.sharedWithUserIds?.length?'Shared':'Private'):(user.role===UserRole.ADMIN?'Administrator':'Shared')}:file;}
  private async canRead(file: FileRecord, user: SessionUser) {
    if(this.isManaged(file))return !!this.managed&&this.managed.canRead(file,user);
    return file.visibility === 'public' || (Array.isArray(file.allowedRoles) && file.allowedRoles.includes(user.role));
  }

  async listFilesForUser(user: SessionUser,context:{ip?:string;userAgent?:string}={}) {
    const files = await this.couchDbService.listFiles();
    const visible:FileRecord[]=[];
    for(const file of files)if(await this.canRead(file,user)){if(this.isManaged(file))await this.managed!.auditAdministratorRead(file,user,context);visible.push(this.presented(file,user));}
    return visible;
  }

  async listAllFiles() {
    return this.couchDbService.listFiles();
  }

  async getById(id: string) {
    if(id.startsWith('upload-')&&this.managed)return this.managed.lookup(id);
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

  async getFileForDownload(fileId: string, user: SessionUser,context:{ip?:string;userAgent?:string}={}) {
    const file = await this.getById(fileId);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (!await this.canRead(file, user)) {
      throw new NotFoundException(this.isManaged(file)?'File not found':'File not available to your role');
    }

    if(this.isManaged(file))await this.managed!.auditAdministratorRead(file,user,context);
    return this.presented(file,user);
  }

  private storedName(name: unknown): string {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.trim() !== name
      || Buffer.from(name, 'utf8').toString('utf8') !== name
      || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name) || /[. ]$/.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      throw new NotFoundException('Stored file not available');
    }
    return name;
  }

  getSecureFilePath(file: FileRecord) {
    const root=this.isManaged(file)?this.managed!.objectsRoot:(this.storageRoot ?? (process.env.NAS_FILES_DIR || './data/files'));
    return resolve(root, this.storedName(file.storedFilename));
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
    await this.managed?.initialize(this.storageRoot);
  }

  private waitForFirstRead(stream: ReadStream) {
    // Keep an error listener installed until the HTTP pipeline takes ownership.
    stream.on('error', () => undefined);
    return new Promise<void>((resolveReady, reject) => {
      const cleanup = () => { stream.off('readable', ready); stream.off('end', ready); stream.off('error', failed); };
      const ready = () => { cleanup(); resolveReady(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      stream.once('readable', ready);
      stream.once('end', ready);
      stream.once('error', failed);
    });
  }

  async readFileStream(file: FileRecord) {
    let handle: FileHandle | undefined;
    let stream: ReadStream | undefined;
    try {
      // Validate the literal name before performing filesystem operations.
      const name = this.storedName(file.storedFilename);
      const managed=this.isManaged(file);
      const root=managed?this.managed!.objectsRoot:(this.storageRoot??=await this.validateStorageRoot());
      const target = resolve(root, name);
      const entry = await fs.lstat(target, { bigint: true });
      if (!entry.isFile() || entry.isSymbolicLink()) throw new NotFoundException('Stored file not available');
      const canonical = await fs.realpath(target);
      const suffix = relative(root, canonical);
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
      if(managed&&(opened.nlink!==1n||size!==file.sizeBytes))throw new Error('Managed file integrity mismatch');
      if(managed){
        // Verify before HTTP headers. A hash check only after sending the last
        // Content-Length byte is too late to prevent a misleading 200 response.
        const hash=createHash('sha256');
        for await(const chunk of handle.createReadStream({autoClose:false,start:0,...(size?{end:size-1}:{})}))hash.update(chunk);
        const checked=await handle.stat({bigint:true});
        if(hash.digest('hex')!==file.sha256||checked.size!==opened.size||checked.mtimeNs!==opened.mtimeNs||checked.ctimeNs!==opened.ctimeNs)throw new Error('Managed file integrity mismatch');
      }
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('Unsupported file size');
      stream = handle.createReadStream({ autoClose: true, start:0, ...(size ? { end: size - 1 } : {}) });
      await this.waitForFirstRead(stream);
      return { stream, size };
    } catch (error: any) {
      this.noteDownloadFailure(file);
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
