import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, describe, it } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { CouchDbService, UserRecord } from '../common/couchdb.service';
import { attachCsrfToken, csrfMiddleware } from '../common/csrf';
import { configureViews } from '../common/views';
import { UserRole } from '../common/roles';
import { UsersService } from './users.service';

// External persistence only: clone reads/writes to model detached CouchDB docs.
class AccountStore {
  users = new Map<string, UserRecord>();
  audits: any[] = [];
  failAudit = false;
  failSave = false;
  afterRead?: (id: string) => void;
  async listUsers() { return structuredClone([...this.users.values()]); }
  async findUserById(id: string) { const user = structuredClone(this.users.get(id) ?? null); this.afterRead?.(id); return user; }
  async findUserByUsername(name: string) { return (await this.listUsers()).find(u => u.username === name) ?? null; }
  async saveUser(user: UserRecord) {
    if (this.failSave) throw Error('private-database-details');
    // Yield across writes so concurrent read-count-write implementations race.
    await new Promise(resolve => setImmediate(resolve));
    this.users.set(user._id!, structuredClone(user)); return structuredClone(user);
  }
  async listFiles() { return []; }
  async logAudit(event: string, details: any, userId?: string, username?: string, ip?: string) {
    if (this.failAudit) throw Error('private-audit-password');
    const doc = { event, details, userId, username, ip, createdAt: new Date().toISOString() };
    this.audits.push(doc); return doc;
  }
}

describe('account-management safety over real Nest HTTP', { concurrency: false }, () => {
  const store = new AccountStore();
  const password = 'AccountPassword123';
  const passwordHash = bcrypt.hashSync(password, 4);
  let app: NestExpressApplication, url: string, users: UsersService, sessions: session.MemoryStore;
  const environment = { NODE_ENV: process.env.NODE_ENV, ALLOW_IN_MEMORY_SESSION_STORE: process.env.ALLOW_IN_MEMORY_SESSION_STORE };
  function fixture(id: string, role: UserRole, isActive = true) {
    store.users.set(id, { _id: id, type: 'user', username: id, email: `${id}@example.test`, passwordHash,
      role, isActive, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  }
  function browser() {
    let cookie = '';
    return { get cookie() { return cookie; }, async request(path: string, body?: Record<string, string>, replay?: string) {
      const result = await fetch(url + path, { method: body ? 'POST' : 'GET', redirect: 'manual',
        headers: { cookie: replay ?? cookie, 'user-agent': 'portal-account-test' }, body: body ? new URLSearchParams(body) : undefined });
      if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie')!.split(';')[0];
      return { status: result.status, headers: result.headers, body: await result.text() };
    } };
  }
  function token(html: string) { const value = /name="_csrf" value="([a-f0-9]{64})"/.exec(html)?.[1]; assert.ok(value); return value; }
  async function login(id = 'admin-a') {
    const client = browser(), csrf = token((await client.request('/login')).body);
    const result = await client.request('/login', { username: id, password, _csrf: csrf });
    assert.equal(result.headers.get('location'), '/');
    return { client, csrf: token((await client.request('/')).body) };
  }
  before(async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_IN_MEMORY_SESSION_STORE = 'true';
    const { AppModule } = await import('../app.module');
    app = await NestFactory.create<NestExpressApplication>({ module: AppModule,
      providers: [{ provide: CouchDbService, useValue: store }] }, { logger: false, abortOnError: false });
    sessions = new session.MemoryStore();
    app.use(helmet());
    app.use(session({ secret: randomUUID(), store: sessions, resave: false, saveUninitialized: false }));
    app.use(express.urlencoded({ extended: false })); app.use(attachCsrfToken); app.use(csrfMiddleware);
    configureViews(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); url = await app.getUrl(); users = app.get(UsersService);
  });
  beforeEach(async () => {
    store.users.clear(); store.audits = []; store.failAudit = false; store.failSave = false; store.afterRead = undefined;
    await new Promise<void>((resolve, reject) => sessions.clear(e => e ? reject(e) : resolve()));
    fixture('admin-a', UserRole.ADMIN); fixture('admin-b', UserRole.ADMIN); fixture('member', UserRole.MEMBER);
  });
  after(async () => { await app?.close(); for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const action = (id: string, active: boolean) => `/admin/users/${id}/${active ? 'enable' : 'disable'}`;
  async function change(actor: Awaited<ReturnType<typeof login>>, id: string, active: boolean) {
    return actor.client.request(action(id, active), { _csrf: actor.csrf, confirmed: 'yes' });
  }

  for (const multiple of [false, true]) it(`rejects backend self-disable with ${multiple ? 'multiple' : 'one active'} administrators and preserves the session`, async () => {
    store.users.get('admin-b')!.isActive = multiple;
    const actor = await login(); const result = await change(actor, 'admin-a', false);
    assert.equal(result.status, 403); assert.equal(store.users.get('admin-a')!.isActive, true);
    assert.equal((await actor.client.request('/admin/users')).status, 200);
    assert.equal(store.audits.filter(a => a.event === 'user.disabled').length, 0);
  });
  it('rejects self-disable directly in the service without any UI or controller', async () => {
    await assert.rejects((users.setUserActive as any)('admin-a', false, 'admin-a'), (e: any) => e.getStatus?.() === 403);
    assert.equal(store.users.get('admin-a')!.isActive, true);
  });
  it('rejects a missing, member, disabled or nonexistent acting administrator in the service', async () => {
    store.users.get('admin-b')!.isActive = false;
    for (const actor of [undefined, 'member', 'admin-b', 'missing']) {
      await assert.rejects((users.setUserActive as any)('admin-a', false, actor), (e: any) => e.getStatus?.() === 403);
    }
    assert.equal(store.users.get('admin-a')!.isActive, true);
  });
  it('never lets disabled administrators count as protection for the last active administrator', async () => {
    store.users.get('admin-b')!.isActive = false;
    const actor = await login(); assert.equal((await change(actor, 'admin-a', false)).status, 403);
    assert.equal([...store.users.values()].filter(u => u.role === UserRole.ADMIN && u.isActive).length, 1);
  });
  it('allows disabling another administrator and rejects a subsequent request from that now-disabled actor', async () => {
    const a = await login(), b = await login('admin-b');
    assert.equal((await change(a, 'admin-b', false)).status, 302);
    assert.equal((await change(b, 'admin-a', false)).status, 401);
    assert.equal(store.users.get('admin-a')!.isActive, true);
  });
  it('serializes simultaneous conflicting administrator operations, including service-level actor revalidation', async () => {
    const results = await Promise.allSettled([
      (users.setUserActive as any)('admin-b', false, 'admin-a'),
      (users.setUserActive as any)('admin-a', false, 'admin-b'),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal([...store.users.values()].filter(u => u.role === UserRole.ADMIN && u.isActive).length, 1);
  });
  it('validates the status value in the service and never persists a non-boolean status', async () => {
    await assert.rejects((users.setUserActive as any)('member', 'false', 'admin-a'), (e: any) => e.getStatus?.() === 400);
    assert.equal(store.users.get('member')!.isActive, true);
  });
  it('serializes duplicate status changes without duplicate successful audit events', async () => {
    await Promise.all([(users.setUserActive as any)('member', false, 'admin-a'), (users.setUserActive as any)('member', false, 'admin-a')]);
    assert.equal(store.audits.filter(a => a.event === 'user.disabled').length, 1);
  });
  it('rejects one of two concurrent conflicting HTTP requests and retains one active administrator', async () => {
    const a = await login(), b = await login('admin-b');
    const responses = await Promise.all([change(a, 'admin-b', false), change(b, 'admin-a', false)]);
    assert.equal(responses.filter(r => r.status === 302).length, 1);
    assert.ok(responses.some(r => [401, 403].includes(r.status)));
    assert.equal([...store.users.values()].filter(u => u.role === UserRole.ADMIN && u.isActive).length, 1);
  });
  for (const role of [UserRole.MEMBER, UserRole.ADMIN]) it(`reactivates a disabled ${role}, preserves account data, and permits a fresh login`, async () => {
    const id = role === UserRole.ADMIN ? 'admin-b' : 'member'; store.users.get(id)!.isActive = false;
    const original = structuredClone(store.users.get(id)!); const actor = await login();
    assert.equal((await change(actor, id, true)).status, 302);
    const updated = store.users.get(id)!;
    for (const key of ['username', 'role', 'email', 'passwordHash', 'createdAt']) assert.equal(updated[key], original[key]);
    assert.equal(updated.isActive, true); const fresh = await login(id);
    assert.equal((await fresh.client.request('/')).status, 200);
  });
  it('makes repeated disable and enable operations idempotent without duplicate success audits', async () => {
    const actor = await login();
    for (const enabled of [false, false, true, true]) assert.equal((await change(actor, 'member', enabled)).status, 302);
    assert.deepEqual(store.audits.filter(a => a.event.startsWith('user.')).map(a => a.event), ['user.disabled', 'user.enabled']);
  });
  for (const active of [false, true]) {
    it(`rejects member ${active ? 'enable' : 'disable'} operations`, async () => {
      store.users.get('admin-b')!.isActive = false;
      const actor = await login('member'); assert.equal((await change(actor, 'admin-b', active)).status, 403);
      assert.equal(store.users.get('admin-b')!.isActive, false);
    });
    it(`rejects unauthenticated ${active ? 'enable' : 'disable'} operations with a valid anonymous CSRF token`, async () => {
      const client = browser(), csrf = token((await client.request('/login')).body);
      assert.equal((await client.request(action('member', active), { _csrf: csrf, confirmed: 'yes' })).status, 401);
    });
    for (const csrf of ['', 'invalid']) it(`rejects ${csrf ? 'invalid' : 'missing'} CSRF for ${active ? 'enable' : 'disable'} without changing the target`, async () => {
      store.users.get('member')!.isActive = !active;
      const actor = await login(); const body: Record<string,string> = { confirmed: 'yes' }; if (csrf) body._csrf = csrf;
      assert.equal((await actor.client.request(action('member', active), body)).status, 403);
      assert.equal(store.users.get('member')!.isActive, !active);
    });
    it(`returns 404 for nonexistent ${active ? 'enable' : 'disable'} target IDs`, async () => {
      assert.equal((await change(await login(), 'missing', active)).status, 404);
    });
  }
  it('requires explicit confirmation on POST and offers an accessible server-rendered confirmation page', async () => {
    const actor = await login(); const result = await actor.client.request(action('member', false), { _csrf: actor.csrf });
    assert.equal(result.status, 400); assert.equal(store.users.get('member')!.isActive, true);
    const page = await actor.client.request(action('member', false));
    assert.equal(page.status, 200); assert.match(page.body, /immediately prevents further authenticated access/i);
    assert.match(page.body, /name="confirmed" value="yes"/); assert.equal(token(page.body), actor.csrf);
    assert.match(page.body, /Cancel/); assert.doesNotMatch(page.body, /onclick=|onsubmit=|<script/i);
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  });
  it('renders authoritative Active/Disabled roles, current administrator and safe controls', async () => {
    store.users.get('admin-b')!.isActive = false;
    const actor = await login(), page = await actor.client.request('/admin/users');
    assert.equal(page.status, 200); assert.match(page.body, /Signed in as.*admin-a/s);
    assert.match(page.body, /Active/); assert.match(page.body, /Disabled/);
    assert.doesNotMatch(page.body, /(?:action|href)="\/admin\/users\/admin-a\/disable"/);
    assert.match(page.body, /action="\/admin\/users\/admin-b\/enable"/);
    assert.match(page.body, /last active administrator/i); assert.match(page.body, /current account/i);
    assert.doesNotMatch(page.body, /\$2[aby]\$/);
  });
  it('displays meaningful status feedback and safe, understandable rejection messages', async () => {
    const actor = await login(); const changed = await change(actor, 'member', false);
    const page = await actor.client.request(changed.headers.get('location')!);
    assert.match(page.body, /Account disabled/);
    const denied = await change(actor, 'admin-a', false);
    assert.match(denied.body, /cannot disable your own account/i);
    assert.match(denied.headers.get('content-type') ?? '', /text\/html/);
  });
  it('invalidates disabled sessions, including cookies never presented while the account was disabled', async () => {
    const actor = await login(), observed = await login('member'), unobserved = await login('member');
    const oldObserved = observed.client.cookie, oldUnobserved = unobserved.client.cookie;
    assert.equal((await change(actor, 'member', false)).status, 302);
    assert.equal((await observed.client.request('/', undefined, oldObserved)).status, 401);
    const failed = browser(), csrf = token((await failed.request('/login')).body);
    assert.equal((await failed.request('/login', { username: 'member', password, _csrf: csrf })).headers.get('location'), '/login?error=invalid');
    assert.equal((await change(actor, 'member', true)).status, 302);
    for (const cookie of [oldObserved, oldUnobserved]) assert.equal((await observed.client.request('/', undefined, cookie)).status, 401);
    assert.equal((await (await login('member')).client.request('/')).status, 200);
  });
  it('already destroys a session observed while disabled and does not restore that destroyed session', async () => {
    const actor = await login(), member = await login('member'); const cookie = member.client.cookie;
    assert.equal((await change(actor, 'member', false)).status, 302);
    assert.equal((await member.client.request('/', undefined, cookie)).status, 401);
    // Restore only this disposable fixture to characterize the existing guard,
    // independently of the missing Enable route.
    store.users.get('member')!.isActive = true;
    assert.equal((await member.client.request('/', undefined, cookie)).status, 401);
  });
  it('rejects an unobserved old cookie after fixture reactivation independently of the Enable route', async () => {
    const actor = await login(), member = await login('member'); const cookie = member.client.cookie;
    assert.equal((await change(actor, 'member', false)).status, 302);
    store.users.get('member')!.isActive = true;
    assert.equal((await member.client.request('/', undefined, cookie)).status, 401);
  });
  it('revokes legacy version-zero cookies when enabling an account disabled before session versioning existed', async () => {
    const actor = await login(), member = await login('member'); const cookie = member.client.cookie;
    // Model a persisted pre-7D disabled account and its never-presented cookie.
    store.users.get('member')!.isActive = false;
    delete store.users.get('member')!.sessionVersion;
    assert.equal((await change(actor, 'member', true)).status, 302);
    assert.equal((await member.client.request('/', undefined, cookie)).status, 401);
    assert.equal((await (await login('member')).client.request('/')).status, 200);
  });
  it('records actor, target, statuses, timestamp and request context without credentials', async () => {
    const actor = await login(); await change(actor, 'member', false); await change(actor, 'member', true);
    const audit = store.audits.filter(a => a.event.startsWith('user.')); assert.equal(audit.length, 2);
    for (const [index, doc] of audit.entries()) {
      assert.equal(doc.userId, 'admin-a'); assert.equal(doc.username, 'admin-a'); assert.equal(doc.details.targetUserId, 'member');
      assert.equal(doc.details.targetUsername, 'member'); assert.equal(doc.details.previousStatus, index ? 'disabled' : 'active');
      assert.equal(doc.details.newStatus, index ? 'active' : 'disabled'); assert.ok(Number.isFinite(Date.parse(doc.createdAt)));
      assert.ok(doc.ip); assert.equal(doc.details.userAgent, 'portal-account-test');
      assert.doesNotMatch(JSON.stringify(doc), /password|passwordHash|csrf|secret|connect\.sid/i);
    }
  });
  it('reports audit persistence failure honestly after a status commit without leaking backend details', async () => {
    const actor = await login(); store.failAudit = true;
    const response = await change(actor, 'member', false);
    assert.equal(response.status, 503); assert.equal(store.users.get('member')!.isActive, false);
    assert.match(response.body, /status changed.*audit/s); assert.doesNotMatch(response.body, /private-audit-password/);
  });
  it('does not modify the account or log success when the account write fails', async () => {
    const actor = await login(); const original = structuredClone(store.users.get('member')!); store.failSave = true;
    const result = await change(actor, 'member', false); assert.equal(result.status, 503);
    assert.deepEqual(store.users.get('member'), original); assert.equal(store.audits.filter(a => a.event.startsWith('user.')).length, 0);
    assert.doesNotMatch(result.body, /private-database-details/);
  });
  it('does not disclose the administration page when the actor is disabled after guard validation', async () => {
    const actor = await login();
    store.afterRead = id => {
      if (id === 'admin-a') { store.afterRead = undefined; store.users.get(id)!.isActive = false; }
    };
    // Simulate an external status transition between the guard's detached read
    // and the service's fresh actor validation. No application guard is mocked.
    const result = await change(actor, 'member', false);
    assert.equal(result.status, 403);
    assert.doesNotMatch(result.body, /<h1>User management|<table|member@example\.test/);
    assert.equal(store.users.get('member')!.isActive, true);
  });
});
