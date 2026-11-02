import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UsersService } from '../../src/users/users.service';
import { UserRole } from '../../src/common/roles';
import { browser, dependencyUrl, launchApplication, unusedPort, within } from './support';

const nano = require('nano');
const databases = ['portal_users', 'portal_files', 'portal_audit', 'portal_downloads'];

describe('production CouchDB authentication and administrator bootstrap', { concurrency: false, timeout: 120000 }, () => {
  let legacyUrl: string;
  let client: any;
  let separate: NodeJS.ProcessEnv;
  const original = { NODE_ENV: process.env.NODE_ENV, COUCHDB_URL: process.env.COUCHDB_URL,
    COUCHDB_USER: process.env.COUCHDB_USER, COUCHDB_PASSWORD: process.env.COUCHDB_PASSWORD };
  const admin = { username: `bootstrap-${randomUUID()}`, email: 'bootstrap@example.test', password: 'BootstrapPassword123' };

  before(() => {
    legacyUrl = dependencyUrl('COUCHDB_URL');
    client = nano(legacyUrl);
    const url = new URL(legacyUrl);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = ''; url.password = '';
    separate = { COUCHDB_URL: url.toString(), COUCHDB_USER: username, COUCHDB_PASSWORD: password };
    process.env.NODE_ENV = 'production';
  });
  after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  async function seed(overrides: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, ['dist/seed-admin.js'], {
      env: { ...process.env, NODE_ENV: 'production', COUCHDB_URL: legacyUrl,
        COUCHDB_USER: undefined, COUCHDB_PASSWORD: undefined,
        ADMIN_USERNAME: admin.username, ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password, ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    try { return { code: await within(exited, 10000, 'Bootstrap did not exit'), output }; }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
  }

  async function storedUser(username = admin.username) {
    const result = await client.use('portal_users').list({ include_docs: true });
    return result.rows.map((row: any) => row.doc).find((user: any) => user.username === username);
  }

  async function startup(overrides: NodeJS.ProcessEnv, succeeds: boolean) {
    const app = await launchApplication(dependencyUrl('REDIS_URL'), overrides);
    try {
      if (succeeds) {
        await within(app.ready, 10000, 'Application did not start with valid production configuration');
        const response = await browser(app.url).request('/login');
        assert.equal(response.status, 200, response.body);
      } else {
        const code = await within(app.exited, 10000, 'Invalid production configuration did not fail startup');
        assert.notEqual(code, 0, app.output);
        assert.doesNotMatch(app.output, /Portal-BSC listening on/);
      }
    } finally { await app.close(); }
  }

  it('bootstraps the first administrator in a fresh database and persists the role', async () => {
    const existing = await client.db.list();
    assert.ok(databases.every((name) => !existing.includes(name)), 'This test requires the fresh disposable CI service');
    const result = await seed();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Admin user created:/);
    const user = await storedUser();
    assert.ok(user);
    assert.equal(user.role, UserRole.ADMIN);
    assert.equal(user.isActive, true);
    assert.ok(await bcrypt.compare(admin.password, user.passwordHash));
    for (const name of databases) assert.equal((await client.db.get(name)).db_name, name);
  });

  it('authenticates and initializes all four databases using separate environment credentials', async () => {
    try {
      Object.assign(process.env, separate);
      const service = new CouchDbService();
      await service.initialize();
      const created = await new UsersService(service).createUser({
        username: `separate-${randomUUID()}`, email: 'separate@example.test', password: admin.password, role: UserRole.MEMBER,
      });
      assert.equal((await client.use('portal_users').get(created._id)).username, created.username);
      for (const name of databases) assert.equal((await client.db.get(name)).db_name, name);
    } finally {
      process.env.COUCHDB_URL = legacyUrl; delete process.env.COUCHDB_USER; delete process.env.COUCHDB_PASSWORD;
    }
  });

  it('starts the production application with separate CouchDB credentials', async () => startup(separate, true));

  it('starts without retaining bootstrap credentials in the runtime environment', async () => {
    await startup({ COUCHDB_URL: legacyUrl, ADMIN_USERNAME: undefined, ADMIN_EMAIL: undefined, ADMIN_PASSWORD: undefined }, true);
  });

  it('rejects missing production database credentials before startup', async () => {
    await startup({ ...separate, COUCHDB_USER: undefined, COUCHDB_PASSWORD: undefined }, false);
  });

  it('rejects incomplete explicit credentials even when the URL contains legacy credentials', async () => {
    await startup({ COUCHDB_URL: legacyUrl, COUCHDB_USER: 'ci-admin', COUCHDB_PASSWORD: undefined }, false);
  });

  it('rejects invalid explicit credentials rather than using legacy credentials or memory', async () => {
    await startup({ ...separate, COUCHDB_URL: legacyUrl, COUCHDB_PASSWORD: 'invalid-test-password' }, false);
  });

  it('does not turn a failed production initialization into success on retry', async () => {
    try {
      // Isolate repeated negative requests from the shared valid administrator's lockout counter.
      const invalid = new URL(legacyUrl);
      invalid.username = `ci-invalid-${randomUUID()}`;
      invalid.password = 'invalid-test-password';
      process.env.COUCHDB_URL = invalid.toString();
      const service = new CouchDbService();
      await assert.rejects(service.initialize());
      await assert.rejects(service.initialize());
      await assert.rejects(service.createUser({
        type: 'user', username: 'never-persisted', email: 'invalid@example.test',
        passwordHash: 'not-a-real-hash', role: UserRole.ADMIN, isActive: true,
      }));
    } finally { process.env.COUCHDB_URL = legacyUrl; }
  });

  it('does not use a memory store for malformed production database configuration', async () => {
    try {
      process.env.COUCHDB_URL = 'not-a-valid-url';
      await assert.rejects(async () => {
        const service = new CouchDbService();
        await service.createUser({ type: 'user', username: 'must-not-exist', email: 'invalid@example.test',
          passwordHash: 'hash', role: UserRole.ADMIN, isActive: true });
      });
    } finally { process.env.COUCHDB_URL = legacyUrl; }
  });

  it('preserves an existing administrator account and password on repeated bootstrap', async () => {
    // Establish the fixture independently so this assertion can run even when first-bootstrap RED fails.
    const service = new CouchDbService(); await service.initialize();
    if (!await storedUser()) await new UsersService(service).createUser({ ...admin, role: UserRole.ADMIN });
    const before = await storedUser();
    const result = await seed({ ADMIN_PASSWORD: 'DifferentPassword456', ADMIN_EMAIL: 'different@example.test' });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Admin user already present:/);
    assert.deepEqual(await storedUser(), before);
  });

  it('refuses member username collisions without changing the role, email, or password', async () => {
    const username = `member-${randomUUID()}`;
    const service = new CouchDbService(); await service.initialize();
    await new UsersService(service).createUser({ ...admin, username, role: UserRole.MEMBER });
    const before = await storedUser(username);
    const result = await seed({ ADMIN_USERNAME: username });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /not an administrator|non-administrator|collision/i);
    assert.doesNotMatch(result.output, /Admin user created:|Admin user already present:|promoted to admin:/);
    assert.deepEqual(await storedUser(username), before);
  });

  it('does not report a disabled administrator as a successful bootstrap', async () => {
    const service = new CouchDbService(); await service.initialize();
    const users = new UsersService(service);
    const username = `disabled-${randomUUID()}`;
    const created = await users.createUser({ ...admin, username, role: UserRole.ADMIN });
    await users.setUserActive(created._id, false);
    const before = await storedUser(username);
    const result = await seed({ ADMIN_USERNAME: username });
    assert.notEqual(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /Admin user created:|Admin user already present:/);
    assert.deepEqual(await storedUser(username), before);
  });

  for (const [name, values] of Object.entries({
    'missing username': { ADMIN_USERNAME: undefined },
    'missing email': { ADMIN_EMAIL: undefined },
    'missing password': { ADMIN_PASSWORD: undefined },
    'invalid email': { ADMIN_EMAIL: 'invalid' },
    'weak password': { ADMIN_PASSWORD: 'weak' },
  })) {
    it(`rejects ${name} bootstrap credentials without writing a user or reporting success`, async () => {
      const username = `invalid-${randomUUID()}`;
      const result = await seed({ ADMIN_USERNAME: username, ...values });
      assert.notEqual(result.code, 0, result.output);
      assert.doesNotMatch(result.output, /Admin user created:|Admin user already present:|promoted to admin:/);
      assert.equal(await storedUser(username), undefined);
    });
  }

  it('fails bootstrap with unavailable CouchDB and never prints a success message', async () => {
    const result = await seed({ COUCHDB_URL: `http://ci-admin:ci-test@127.0.0.1:${await unusedPort()}` });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /Failed to seed admin:/);
    assert.doesNotMatch(result.output, /Admin user created:|Admin user already present:|promoted to admin:/);
  });

  it('refuses bootstrap fallback even outside production when CouchDB is unavailable', async () => {
    const result = await seed({ NODE_ENV: 'test', COUCHDB_URL: 'invalid-local-database-url' });
    assert.notEqual(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /Admin user created:|Admin user already present:/);
  });
});
