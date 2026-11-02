/// <reference path="./types/express.d.ts" />
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import { engine } from 'express-handlebars';
import { CouchDbService, UserRecord } from './common/couchdb.service';
import { attachCsrfToken, csrfMiddleware } from './common/csrf';
import { UserRole } from './common/roles';
import { UsersService } from './users/users.service';

// Only the external database adapter is replaced. The AppModule's controllers,
// services (including bcrypt), guards, and HTTP middleware all run normally.
class TemporaryCouchStore {
  readonly users = new Map<string, UserRecord>();
  readonly audits: string[] = [];

  async createUser(user: Omit<UserRecord, '_id' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString();
    const record = { ...user, _id: randomUUID(), createdAt: now, updatedAt: now };
    this.users.set(record._id, record);
    return record;
  }

  async findUserByUsername(username: string) {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async listUsers() {
    return [...this.users.values()];
  }

  async logAudit(event: string) {
    this.audits.push(event);
  }
}

describe('CSRF HTTP integration', { concurrency: false }, () => {
  const database = new TemporaryCouchStore();
  const credentials = { username: 'test-admin', password: 'TestPassword123' };
  const newUser = {
    username: 'new-member',
    email: 'new-member@example.test',
    password: 'MemberPassword123',
    role: UserRole.MEMBER,
  };
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_IN_MEMORY_SESSION_STORE: process.env.ALLOW_IN_MEMORY_SESSION_STORE,
  };
  let app: NestExpressApplication;
  let sessionStore: session.MemoryStore;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_IN_MEMORY_SESSION_STORE = 'true';
    // Import after setting the environment so configuration is initialized in test mode.
    const { AppModule } = await import('./app.module');
    app = await NestFactory.create<NestExpressApplication>({
      module: AppModule,
      providers: [{ provide: CouchDbService, useValue: database }],
    }, { logger: false, abortOnError: false });

    // Match main.ts's session, form parsing, CSRF, views, and DTO validation.
    const isProduction = process.env.NODE_ENV === 'production';
    const allowMemoryFallback = !isProduction && process.env.ALLOW_IN_MEMORY_SESSION_STORE === 'true';
    assert.equal(allowMemoryFallback, true);
    sessionStore = new session.MemoryStore();
    app.set('trust proxy', 1);
    app.use(session({
      secret: randomUUID(),
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 60 * 60 * 1000 },
      proxy: true,
    }));
    app.use(express.urlencoded({ extended: false }));
    app.use(attachCsrfToken);
    app.use(csrfMiddleware);
    app.setBaseViewsDir(join(process.cwd(), 'views'));
    app.engine('hbs', engine({
      extname: '.hbs',
      defaultLayout: 'main',
      layoutsDir: join(process.cwd(), 'views/layouts'),
      partialsDir: join(process.cwd(), 'views/partials'),
    }));
    app.setViewEngine('hbs');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    database.users.clear();
    database.audits.length = 0;
    await new Promise<void>((resolve, reject) => sessionStore.clear((error) => error ? reject(error) : resolve()));
    await app.get(UsersService).createUser({ ...credentials, email: 'admin@example.test', role: UserRole.ADMIN });
  });

  after(async () => {
    try {
      await app?.close();
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  function browser() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path: string, body?: Record<string, string>, headers: Record<string, string> = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...headers },
          body: body === undefined ? undefined : new URLSearchParams(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: response.status, headers: response.headers, body: await response.text() };
      },
    };
  }

  async function getToken(client: ReturnType<typeof browser>) {
    const response = await client.request('/login');
    assert.equal(response.status, 200, response.body);
    const token = /name="_csrf" value="([^"]+)"/.exec(response.body)?.[1];
    assert.ok(token, 'The actual login form must provide a CSRF token');
    assert.ok(client.cookie, 'The actual session middleware must issue a cookie');
    return token;
  }

  async function anonymous() {
    const client = browser();
    return { client, token: await getToken(client) };
  }

  async function loggedIn(role = UserRole.ADMIN) {
    if (role !== UserRole.ADMIN) {
      await app.get(UsersService).createUser({
        username: 'test-member', email: 'member@example.test', password: credentials.password, role,
      });
    }
    const { client, token } = await anonymous();
    const response = await client.request('/login', {
      ...credentials, username: role === UserRole.ADMIN ? credentials.username : 'test-member',
    }, { 'x-csrf-token': token });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/');
    // Login regenerates the session. Fetch the new session's token over HTTP.
    return { client, token: await getToken(client) };
  }

  it('accepts valid login form submissions and persists a regenerated admin session', async () => {
    const client = browser();
    const token = await getToken(client);
    const anonymousCookie = client.cookie;
    const response = await client.request('/login', { ...credentials, _csrf: token });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/');
    assert.notEqual(client.cookie, anonymousCookie, 'Login must regenerate the session');
    assert.deepEqual(database.audits, ['login.success']);

    const newToken = await getToken(client);
    const protectedResponse = await client.request('/admin/users', newUser, { 'x-csrf-token': newToken });
    assert.equal(protectedResponse.status, 302, protectedResponse.body);
    assert.equal((await database.findUserByUsername(newUser.username))?.role, UserRole.MEMBER);
  });

  it('accepts legitimate administrator user-creation form submissions', async () => {
    const { client, token } = await loggedIn();
    const response = await client.request('/admin/users', { ...newUser, _csrf: token });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/admin/users');
    const user = await database.findUserByUsername(newUser.username);
    assert.ok(user);
    assert.equal(user.email, newUser.email);
    assert.equal(user.role, UserRole.MEMBER);
    assert.notEqual(user.passwordHash, newUser.password);
    assert.ok(await app.get(UsersService).findById(user._id));

    const member = browser();
    const memberToken = await getToken(member);
    const login = await member.request('/login', {
      username: newUser.username, password: newUser.password,
    }, { 'x-csrf-token': memberToken });
    assert.equal(login.status, 302, login.body);
    assert.equal(login.headers.get('location'), '/');
  });

  for (const tokenCase of ['missing', 'invalid', 'another session'] as const) {
    for (const path of ['/login', '/admin/users']) {
      it(`rejects ${tokenCase} CSRF tokens on ${path} without side effects`, async () => {
        const { client, token } = await (path === '/login' ? anonymous() : loggedIn());
        const submittedToken = tokenCase === 'missing' ? {}
          : { _csrf: tokenCase === 'invalid' ? `${token}-invalid` : await getToken(browser()) };
        const initialAudits = [...database.audits];
        const response = await client.request(path, {
          ...(path === '/login' ? credentials : newUser), ...submittedToken,
        });
        assert.equal(response.status, 403, response.body);
        assert.match(response.body, /Invalid or missing CSRF token/);
        assert.deepEqual(database.audits, initialAudits);
        assert.equal(await database.findUserByUsername(newUser.username), null);
      });
    }
  }

  it('continues accepting CSRF headers without a form token', async () => {
    const { client, token } = await loggedIn();
    const response = await client.request('/admin/users', newUser, { 'x-csrf-token': token });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/admin/users');
    assert.ok(await database.findUserByUsername(newUser.username));
  });

  it('rejects an invalid form token even when the header token is valid', async () => {
    const client = browser();
    const token = await getToken(client);
    const response = await client.request('/login', { ...credentials, _csrf: 'invalid' }, { 'x-csrf-token': token });
    assert.equal(response.status, 403, response.body);
    assert.deepEqual(database.audits, []);
  });

  for (const path of ['/login', '/admin/users']) {
    it(`preserves strict DTO rejection of unexpected fields on ${path}`, async () => {
      const { client, token } = await (path === '/login' ? anonymous() : loggedIn());
      const response = await client.request(path, {
        ...(path === '/login' ? credentials : newUser), _csrf: token, unexpected: 'must-be-rejected',
      });
      assert.equal(response.status, 400, response.body);
      const error = JSON.parse(response.body);
      assert.deepEqual(error.message, ['property unexpected should not exist']);
      assert.equal(await database.findUserByUsername(newUser.username), null);
    });
  }

  it('preserves DTO validation for invalid user-creation fields', async () => {
    const { client, token } = await loggedIn();
    const response = await client.request('/admin/users', {
      ...newUser, email: 'invalid', password: 'weak', role: 'owner',
    }, { 'x-csrf-token': token });
    assert.equal(response.status, 400, response.body);
    assert.match(response.body, /email must be an email/);
    assert.match(response.body, /password must be longer than or equal to 8 characters/);
    assert.match(response.body, /role must be one of the following values/);
    assert.equal(await database.findUserByUsername(newUser.username), null);
  });

  it('rejects unauthenticated user creation even with valid CSRF', async () => {
    const client = browser();
    const token = await getToken(client);
    const response = await client.request('/admin/users', newUser, { 'x-csrf-token': token });
    assert.equal(response.status, 401, response.body);
    assert.equal(await database.findUserByUsername(newUser.username), null);
  });

  it('rejects member user creation even with valid CSRF', async () => {
    const { client, token } = await loggedIn(UserRole.MEMBER);
    const response = await client.request('/admin/users', newUser, { 'x-csrf-token': token });
    assert.equal(response.status, 403, response.body);
    assert.match(response.body, /Admin access required/);
    assert.equal(await database.findUserByUsername(newUser.username), null);
  });
});
