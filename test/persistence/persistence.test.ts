import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UsersService } from '../../src/users/users.service';
import { FilesService } from '../../src/files/files.service';
import { AuditService } from '../../src/audit/audit.service';
import { UserRole } from '../../src/common/roles';
import { browser, formToken } from '../integration/support';

const exec = promisify(execFile);
const nano = require('nano');

describe('production Compose storage and application container', { concurrency: false, timeout: 180000 }, () => {
  const project = `portal-ci-${randomUUID()}`;
  const password = 'CiPersistencePassword123';
  const adminPassword = 'CiAdministratorPassword123';
  const client = nano({ url: 'http://127.0.0.1:5984', requestDefaults: { auth: { username: 'ci-admin', password } } });
  let createdEnv = false;
  let attemptedStack = false;
  let initialized = false;
  let volumeName: string;
  let records: { user: any; file: any; audit: any };
  let nasDirectory: string;

  async function compose(args: string[], override = true, environment: NodeJS.ProcessEnv = {}) {
    return exec('docker', ['compose', '--project-name', project, '--env-file', '.env',
      '-f', 'docker-compose.app.yml', ...(override ? ['-f', 'test/persistence/compose.ci.yml'] : []), ...args],
    { timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...environment } });
  }

  before(async () => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only disposable GitHub-hosted CI resources may run this suite');
    assert.equal(process.env.INTEGRATION_TESTS, '1');
    nasDirectory = await mkdtemp(join(tmpdir(), 'portal-compose-nas-'));
    await writeFile(join(nasDirectory, 'sentinel.txt'), 'pre-existing NAS fixture');
    // Exclusive creation: never replace a user's environment file.
    await writeFile('.env', [
      'NODE_ENV=production', `SESSION_SECRET=${randomUUID()}`, 'COUCHDB_USER=ci-admin',
      `COUCHDB_PASSWORD=${password}`, 'ADMIN_USERNAME=persistence-admin',
      'ADMIN_EMAIL=persistence@example.test', `ADMIN_PASSWORD=${adminPassword}`,
      `NAS_FILES_HOST_PATH=${nasDirectory}`,
    ].join('\n'), { flag: 'wx' });
    createdEnv = true;
    Object.assign(process.env, { NODE_ENV: 'production', COUCHDB_URL: 'http://127.0.0.1:5984',
      COUCHDB_USER: 'ci-admin', COUCHDB_PASSWORD: password });
  });

  after(async () => {
    try {
      if (attemptedStack) {
        try {
          const logs = await compose(['logs', '--no-color', '--tail', '60']);
          console.log(logs.stdout);
        } catch (error) { console.error('Could not collect disposable container diagnostics:', error); }
        await compose(['down', '--timeout', '10']); // Deliberately never --volumes / -v.
        if (volumeName) {
          const result = await exec('docker', ['volume', 'inspect', volumeName]);
          assert.equal(JSON.parse(result.stdout)[0].Name, volumeName, 'Cleanup must retain the data volume');
        }
      }
    } finally {
      if (createdEnv) await unlink('.env');
      if (nasDirectory) await rm(nasDirectory, { recursive: true, force: true });
    }
  });

  async function productionConfig() {
    const result = await compose(['config', '--format', 'json'], false);
    const config = JSON.parse(result.stdout);
    const couch = config.services.couchdb;
    assert.equal(couch.environment?.COUCHDB_USER, 'ci-admin', 'Production CouchDB must receive its administrator username');
    assert.equal(couch.environment?.COUCHDB_PASSWORD, password, 'Production CouchDB must receive its administrator password');
    assert.ok(couch.volumes?.some((mount: any) => mount.type === 'volume' && mount.target === '/opt/couchdb/data'),
      'Production CouchDB must use a persistent named volume');
    assert.ok(!couch.ports?.length, 'Production CouchDB must not publish a host port');
    assert.equal(config.services.app.environment.COUCHDB_URL, 'http://couchdb:5984');
    return config;
  }

  async function ready(operation: () => Promise<unknown>) {
    const until = Date.now() + 25000;
    let last: unknown;
    while (Date.now() < until) {
      try { await operation(); return; } catch (error) { last = error; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw last;
  }

  async function applicationReady() {
    await ready(async () => {
      const page = await browser('http://127.0.0.1:3000').request('/login');
      assert.equal(page.status, 200, page.body);
    });
  }

  async function dataMount() {
    const id = (await compose(['ps', '--quiet', 'couchdb'])).stdout.trim();
    const container = JSON.parse((await exec('docker', ['inspect', id])).stdout)[0];
    const mount = container.Mounts.find((entry: any) => entry.Destination === '/opt/couchdb/data');
    assert.equal(mount.Type, 'volume');
    return { id, volume: mount.Name };
  }

  async function ensureStack() {
    await productionConfig();
    if (initialized) return;
    attemptedStack = true;
    await compose(['up', '-d', '--no-build']);
    await ready(async () => { assert.equal((await client.session()).userCtx.name, 'ci-admin'); });
    await applicationReady();
    volumeName = (await dataMount()).volume;
    assert.equal((await client.use('portal_users').list()).rows.length, 0, 'The disposable data volume must initially be empty');
    const seed = await compose(['exec', '-T', 'app', 'node', 'dist/seed-admin.js']);
    assert.match(seed.stdout, /Admin user created:/);
    const service = new CouchDbService(); await service.initialize();
    const user = await new UsersService(service).createUser({ username: `persist-${randomUUID()}`,
      email: 'persist@example.test', password: adminPassword, role: UserRole.MEMBER });
    const file = await new FilesService(service).createSeedFile({ title: `Persistent ${randomUUID()}`,
      storedFilename: 'persist.pdf', originalFilename: 'persist.pdf', mimeType: 'application/pdf',
      sizeBytes: 17, sha256: 'persistence-fixture', visibility: 'public' });
    const audit = await new AuditService(service).logLoginSuccess(user._id, user.username);
    records = { user, file, audit };
    initialized = true;
  }

  async function verifyData() {
    const service = new CouchDbService(); await service.initialize();
    const user = await service.findUserById(records.user._id);
    assert.equal(user?.username, records.user.username);
    assert.equal(user.passwordHash, records.user.passwordHash);
    const file = await service.findFileById(records.file._id);
    assert.equal(file?.title, records.file.title);
    assert.equal(file.sha256, records.file.sha256);
    const audit = await client.use('portal_audit').get(records.audit._id);
    assert.equal(audit.event, records.audit.event);
    assert.equal(audit.userId, records.user._id);
    const persistedAdmin = (await service.listUsers()).find((entry) => entry.username === 'persistence-admin');
    assert.equal(persistedAdmin?.role, UserRole.ADMIN);
  }

  it('validates production Compose credentials, persistent storage, and private CouchDB networking', async () => {
    await productionConfig();
  });

  it('requires a persistent CouchDB data volume in production Compose independently of authentication', async () => {
    const result = await compose(['config', '--format', 'json'], false);
    const config = JSON.parse(result.stdout);
    assert.ok(config.services.couchdb.volumes?.some((mount: any) => mount.type === 'volume' && mount.target === '/opt/couchdb/data'),
      'Production CouchDB must use a persistent named volume');
  });

  it('requires an explicit production NAS host path instead of supplying a replacement default', async () => {
    await assert.rejects(compose(['config', '--format', 'json'], false, { NAS_FILES_HOST_PATH: '' }), /NAS_FILES_HOST_PATH/);
  });

  it('configures the production NAS mount read-only with host-directory creation disabled', async () => {
    const config = await productionConfig();
    const mount = config.services.app.volumes.find((entry: any) => entry.target === '/var/lib/portal-bsc/files');
    assert.equal(mount.type, 'bind');
    assert.equal(mount.source, nasDirectory);
    assert.equal(mount.read_only, true);
    assert.equal(mount.bind.create_host_path, false);
  });

  it('rejects a missing NAS bind source without creating it on the Docker host', async () => {
    const path = join(nasDirectory, 'missing-host-bind');
    let failure: unknown;
    try {
      await compose(['run', '--rm', '--no-deps', '--entrypoint', 'node', 'app', '-e', 'process.exit(0)'], true,
        { NAS_FILES_HOST_PATH: path });
    } catch (error) { failure = error; }
    let created = false;
    try { await stat(path); created = true; } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(created, false, 'Compose must not silently create a missing NAS directory');
    assert.ok(failure, 'The Docker mount operation must reject a missing bind source');
  });

  it('initializes a fresh production stack, bootstraps an administrator, and persists records', async () => {
    await ensureStack();
    for (const name of ['portal_users', 'portal_files', 'portal_audit', 'portal_downloads']) {
      assert.equal((await client.db.get(name)).db_name, name);
    }
    await verifyData();
  });

  it('retains user, file, and audit records across a CouchDB restart', async () => {
    await ensureStack();
    await compose(['restart', 'couchdb']);
    await ready(() => client.db.get('portal_users'));
    assert.equal((await dataMount()).volume, volumeName);
    await verifyData();
  });

  it('reads the existing NAS bind and rejects writes inside the actual production container', async () => {
    await ensureStack();
    const result = await compose(['exec', '-T', 'app', 'node', '-e',
      "const fs=require('fs');const root='/var/lib/portal-bsc/files';if(fs.readFileSync(root+'/sentinel.txt','utf8')!=='pre-existing NAS fixture')throw Error('Wrong NAS mount');try{fs.writeFileSync(root+'/forbidden-write','x');process.exitCode=2;}catch(error){if(error.code!=='EROFS')throw error;console.log('Read-only NAS mount enforced');}"]);
    assert.match(result.stdout, /Read-only NAS mount enforced/);
  });

  it('retains the same volume and records after container recreation and fresh application startup', async () => {
    await ensureStack();
    const before = await dataMount();
    await compose(['up', '-d', '--no-deps', '--force-recreate', 'couchdb']);
    await ready(() => client.db.get('portal_users'));
    const after = await dataMount();
    assert.notEqual(after.id, before.id, 'A different CouchDB container must actually have been created');
    assert.equal(after.volume, before.volume);
    await verifyData();
    await compose(['restart', 'app']);
    await applicationReady();
    const http = browser('http://127.0.0.1:3000');
    const loginPage = await http.request('/login');
    const login = await http.request('/login', { username: 'persistence-admin', password: adminPassword, _csrf: formToken(loginPage.body) });
    assert.equal(login.status, 302, login.body);
    assert.equal(login.headers.get('location'), '/');
    const files = await http.request('/files');
    assert.equal(files.status, 200, files.body);
    assert.ok(files.body.includes(records.file.title));
  });
});
