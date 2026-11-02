import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UserRole } from '../../src/common/roles';
import { UsersService } from '../../src/users/users.service';
import { FilesService } from '../../src/files/files.service';
import { AuditService } from '../../src/audit/audit.service';
import { dependencyUrl } from './support';

const nano = require('nano');

describe('real CouchDB 3 integration', { concurrency: false, timeout: 30000 }, () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let url: string;
  let client: any;

  before(() => {
    url = dependencyUrl('COUCHDB_URL');
    // A failed database connection must never be hidden by the local fallback.
    process.env.NODE_ENV = 'production';
    client = nano(url);
  });
  after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  async function database() {
    const service = new CouchDbService();
    await service.initialize();
    return service;
  }

  it('authenticates to the actual CouchDB service', async () => {
    const response = await client.session();
    assert.equal(response.userCtx.name, 'ci-admin');
    assert.ok(response.userCtx.roles.includes('_admin'));
  });

  it('initializes all four databases and can initialize them again', async () => {
    await database();
    for (const name of ['portal_users', 'portal_files', 'portal_audit', 'portal_downloads']) {
      const info = await client.db.get(name);
      assert.equal(info.db_name, name);
    }
    await database();
  });

  it('creates users and retrieves persisted records through a fresh service', async () => {
    const users = new UsersService(await database());
    const username = `ci-user-${randomUUID()}`;
    const created = await users.createUser({
      username, email: 'integration@example.test', password: 'TemporaryPassword123', role: UserRole.MEMBER,
    });
    const persisted = await client.use('portal_users').get(created._id);
    assert.equal(persisted.username, username);
    assert.notEqual(persisted.passwordHash, 'TemporaryPassword123');
    const fresh = await database();
    assert.equal((await fresh.findUserById(created._id))?.username, username);
    assert.equal((await fresh.findUserByUsername(username))?._id, created._id);
  });

  it('persists file metadata in CouchDB and reads it through a fresh service', async () => {
    const files = new FilesService(await database());
    const title = `ci-file-${randomUUID()}`;
    const created = await files.createSeedFile({
      title, storedFilename: 'ci-file.pdf', originalFilename: 'fixture.pdf',
      mimeType: 'application/pdf', sizeBytes: 123, sha256: 'integration-sha256',
      allowedRoles: [UserRole.ADMIN],
    });
    const persisted = await client.use('portal_files').get(created._id);
    assert.equal(persisted.title, title);
    assert.equal(persisted.sizeBytes, 123);
    assert.deepEqual(persisted.allowedRoles, [UserRole.ADMIN]);
    const fresh = await database();
    assert.equal((await fresh.findFileById(created._id))?.storedFilename, 'ci-file.pdf');
    assert.ok((await fresh.listFiles()).some((file) => file._id === created._id));
  });

  it('persists actual audit-service records in CouchDB', async () => {
    const audit = new AuditService(await database());
    const username = `ci-audit-${randomUUID()}`;
    const created = await audit.logLoginSuccess('ci-user-id', username, '127.0.0.1');
    const persisted = await client.use('portal_audit').get(created._id);
    assert.equal(persisted.type, 'audit');
    assert.equal(persisted.event, 'login.success');
    assert.equal(persisted.userId, 'ci-user-id');
    assert.equal(persisted.details.username, username);
    assert.ok(persisted.createdAt);
  });

  it('rejects invalid CouchDB credentials without falling back to memory', async () => {
    const invalid = new URL(url);
    invalid.password = 'deliberately-wrong-test-password';
    await assert.rejects(nano(invalid.toString()).session(), (error: any) => error.statusCode === 401);
    try {
      process.env.COUCHDB_URL = invalid.toString();
      const service = new CouchDbService();
      await assert.rejects(service.initialize(), /CouchDB readiness check failed/);
    } finally {
      process.env.COUCHDB_URL = url;
    }
  });
});
