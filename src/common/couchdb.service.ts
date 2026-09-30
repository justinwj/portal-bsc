import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserRole } from './roles';

const nano = require('nano');

export interface UserRecord {
  _id?: string;
  type: 'user';
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  _id?: string;
  type: 'file';
  title: string;
  description: string;
  storedFilename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string;
  visibility: 'public' | 'private';
  allowedRoles: UserRole[];
  uploadedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  _id?: string;
  type: 'audit';
  event: string;
  userId?: string;
  username?: string;
  ip?: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface DownloadRecord {
  _id?: string;
  type: 'download';
  userId: string;
  fileId: string;
  fileTitle: string;
  createdAt: string;
}

@Injectable()
export class CouchDbService {
  private readonly logger = new Logger(CouchDbService.name);
  private readonly inMemory = {
    users: new Map<string, UserRecord>(),
    files: new Map<string, FileRecord>(),
    audits: new Map<string, AuditRecord>(),
    downloads: new Map<string, DownloadRecord>(),
  };
  private db?: any;

  constructor() {
    const couchDbUrl = process.env.COUCHDB_URL || 'http://localhost:5984';
    try {
      const client = nano(couchDbUrl);
      this.db = client.db;
      void this.ensureDatabases();
    } catch (error) {
      this.logger.warn('CouchDB unavailable, using in-memory fallback store');
    }
  }

  private async ensureDatabases() {
    if (!this.db) return;
    const names = ['portal_users', 'portal_files', 'portal_audit', 'portal_downloads'];
    for (const name of names) {
      try {
        await this.db.get(name);
      } catch (error: any) {
        if (error.statusCode === 404) {
          await this.db.create(name);
        }
      }
    }
  }

  async createUser(user: Omit<UserRecord, '_id' | 'createdAt' | 'updatedAt'>): Promise<UserRecord> {
    if (this.db) {
      const doc = {
        ...user,
        _id: randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.db.use('portal_users').insert(doc);
      return doc;
    }
    const doc: UserRecord = {
      ...user,
      _id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.inMemory.users.set(doc._id, doc);
    return doc;
  }

  async listUsers(): Promise<UserRecord[]> {
    if (this.db) {
      const result = await this.db.use('portal_users').list({ include_docs: true });
      return (result.rows || []).map((row: any) => row.doc).filter(Boolean);
    }
    return Array.from(this.inMemory.users.values());
  }

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    if (this.db) {
      const result = await this.db.use('portal_users').list({ include_docs: true });
      const doc = (result.rows || [])
        .map((row: any) => row.doc)
        .find((row: any) => row && row.username && row.username === username);
      return doc || null;
    }
    return Array.from(this.inMemory.users.values()).find((user) => user.username === username) || null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    if (this.db) {
      try {
        return await this.db.use('portal_users').get(id);
      } catch {
        return null;
      }
    }
    return this.inMemory.users.get(id) || null;
  }

  async saveUser(user: UserRecord): Promise<UserRecord> {
    if (this.db) {
      const db = this.db.use('portal_users');
      const next = { ...user, updatedAt: new Date().toISOString() };
      await db.insert(next);
      return next;
    }
    this.inMemory.users.set(user._id, { ...user, updatedAt: new Date().toISOString() });
    return this.inMemory.users.get(user._id)!;
  }

  async listFiles(): Promise<FileRecord[]> {
    if (this.db) {
      const result = await this.db.use('portal_files').list({ include_docs: true });
      return (result.rows || []).map((row: any) => row.doc).filter(Boolean);
    }
    return Array.from(this.inMemory.files.values());
  }

  async findFileById(id: string): Promise<FileRecord | null> {
    if (this.db) {
      try {
        return await this.db.use('portal_files').get(id);
      } catch {
        return null;
      }
    }
    return this.inMemory.files.get(id) || null;
  }

  async createFile(file: Omit<FileRecord, '_id' | 'createdAt' | 'updatedAt'>): Promise<FileRecord> {
    if (this.db) {
      const doc = {
        ...file,
        _id: randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.db.use('portal_files').insert(doc);
      return doc;
    }
    const doc: FileRecord = {
      ...file,
      _id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.inMemory.files.set(doc._id, doc);
    return doc;
  }

  async logAudit(event: string, details: Record<string, any> = {}, userId?: string, username?: string, ip?: string): Promise<AuditRecord> {
    const doc: AuditRecord = {
      _id: randomUUID(),
      type: 'audit',
      event,
      userId,
      username,
      ip,
      details,
      createdAt: new Date().toISOString(),
    };
    if (this.db) {
      await this.db.use('portal_audit').insert(doc);
      return doc;
    }
    this.inMemory.audits.set(doc._id, doc);
    return doc;
  }

  async logDownload(userId: string, fileId: string, fileTitle: string): Promise<DownloadRecord> {
    const doc: DownloadRecord = {
      _id: randomUUID(),
      type: 'download',
      userId,
      fileId,
      fileTitle,
      createdAt: new Date().toISOString(),
    };
    if (this.db) {
      await this.db.use('portal_downloads').insert(doc);
      return doc;
    }
    this.inMemory.downloads.set(doc._id, doc);
    return doc;
  }
}
