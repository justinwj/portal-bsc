/// <reference path="./types/express.d.ts" />
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import session from 'express-session';
import { CouchDbService, FileRecord, UserRecord } from './common/couchdb.service';
import { attachCsrfToken, csrfMiddleware } from './common/csrf';
import { SessionUser, UserRole } from './common/roles';
import { configureViews } from './common/views';
import { UsersService } from './users/users.service';

type StoredSession = session.SessionData & { user?: SessionUser; csrfToken?: string };

// Only the external database adapter is replaced. The AppModule's controllers,
// services (including bcrypt), guards, and HTTP middleware all run normally.
class TemporaryCouchStore {
  readonly users = new Map<string, UserRecord>();
  readonly audits: string[] = [];
  fileLookupError?: Error;
  readonly file: FileRecord = {
    _id: 'test-file', type: 'file', title: 'Test document', description: 'HTTP view fixture',
    storedFilename: 'test.pdf', originalFilename: 'test.pdf', mimeType: 'application/pdf',
    sizeBytes: 1, sha256: 'test', category: 'docs', visibility: 'public', allowedRoles: [],
    uploadedByUserId: 'fixture', createdAt: '', updatedAt: '',
  };

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

  async listFiles() {
    return [this.file];
  }

  async findFileById(id: string) {
    if (this.fileLookupError) throw this.fileLookupError;
    return id === this.file._id ? this.file : null;
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
    configureViews(app);
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
    database.fileLookupError = undefined;
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
      async request(path: string, body?: Record<string, string> | string, headers: Record<string, string> = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...headers },
          body: body === undefined ? undefined : typeof body === 'string' ? body : new URLSearchParams(body),
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

  function storedSessions() {
    return new Promise<Record<string, StoredSession>>((resolve, reject) => {
      sessionStore.all((error, sessions) => error ? reject(error) : resolve(sessions as Record<string, StoredSession>));
    });
  }

  function logoutToken(html: string) {
    const form = /<form\b[^>]*action="\/logout"[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1];
    assert.ok(form, 'The page must render the logout form');
    const token = /name="_csrf" value="([^"]*)"/.exec(form)?.[1];
    assert.match(token ?? '', /^[a-f0-9]{64}$/, 'The logout form must contain a nonempty CSRF token');
    return token!;
  }

  describe('authenticated rendering and logout', () => {
    for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
      const paths = ['/', '/files', '/files/test-file', ...(role === UserRole.ADMIN ? ['/admin/users'] : [])];

      it(`renders the ${role} dashboard with role-specific navigation`, async () => {
        const { client } = await loggedIn(role);
        const response = await client.request('/');
        assert.equal(response.status, 200, response.body);
        assert.match(response.body, new RegExp(`Welcome, test-${role}`));
        assert.match(response.body, /href="\/">Dashboard<\/a>/);
        assert.match(response.body, /href="\/files">Files<\/a>/);
        if (role === UserRole.ADMIN) {
          assert.match(response.body, /href="\/admin\/users">Users<\/a>/);
          assert.match(response.body, /href="\/admin\/users">Manage users<\/a>/);
        } else {
          assert.doesNotMatch(response.body, /href="\/admin\/users"/);
          const forbidden = await client.request('/admin/users');
          assert.equal(forbidden.status, 403, forbidden.body);
        }
      });

      for (const path of paths) {
        it(`provides a working logout CSRF token on ${role} ${path}`, async () => {
          const { client, token } = await loggedIn(role);
          const page = await client.request(path);
          assert.equal(page.status, 200, page.body);
          const renderedToken = logoutToken(page.body);
          assert.equal(renderedToken, token, 'The rendered token must belong to the authenticated session');
          const response = await client.request('/logout', { _csrf: renderedToken });
          assert.equal(response.status, 302, response.body);
          assert.equal(response.headers.get('location'), '/login');
        });
      }

      it(`destroys the ${role} session and rejects the old cookie on protected routes`, async () => {
        const { client, token } = await loggedIn(role);
        const oldCookie = client.cookie;
        const sessionsBefore = await storedSessions();
        assert.equal(Object.keys(sessionsBefore).length, 1);
        const [sessionId, authenticatedSession] = Object.entries(sessionsBefore)[0];
        assert.equal(authenticatedSession.user?.role, role);

        const response = await client.request('/logout', { _csrf: token });
        assert.equal(response.status, 302, response.body);
        assert.equal(response.headers.get('location'), '/login');
        assert.match(response.headers.get('set-cookie') ?? '', /connect\.sid=;/);
        assert.match(response.headers.get('set-cookie') ?? '', /Expires=Thu, 01 Jan 1970/i);
        assert.equal((await storedSessions())[sessionId], undefined, 'Logout must delete the stored session');

        for (const path of paths) {
          const replay = await client.request(path, undefined, { cookie: oldCookie });
          assert.equal(replay.status, 401, `${path}: ${replay.body}`);
          assert.match(replay.body, /Authentication required/);
        }
        const staleToken = await client.request('/logout', { _csrf: token }, { cookie: oldCookie });
        assert.equal(staleToken.status, 403, staleToken.body);
      });

      for (const tokenCase of ['missing', 'invalid', 'another session'] as const) {
        it(`rejects ${tokenCase} logout CSRF for ${role} without destroying the session`, async () => {
          const { client, token } = await loggedIn(role);
          const oldCookie = client.cookie;
          const sessionsBefore = await storedSessions();
          const [sessionId, authenticatedSession] = Object.entries(sessionsBefore)[0];
          const body = tokenCase === 'missing' ? {}
            : { _csrf: tokenCase === 'invalid' ? `${token}-invalid` : await getToken(browser()) };
          const response = await client.request('/logout', body);
          assert.equal(response.status, 403, response.body);
          assert.match(response.body, /Invalid or missing CSRF token/);
          assert.equal(client.cookie, oldCookie);
          const sessionAfter = (await storedSessions())[sessionId];
          assert.ok(sessionAfter, 'A rejected logout must leave the authenticated session intact');
          assert.deepEqual(sessionAfter.user, authenticatedSession.user);
          assert.equal(sessionAfter.csrfToken, token);
        });
      }
    }
  });

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

  describe('framework migration HTTP characterization', () => {
    it('authenticates JSON credentials with a session-bound CSRF header', async () => {
      const { client, token } = await anonymous();
      const response = await client.request('/login', JSON.stringify(credentials), {
        'content-type': 'application/json', 'x-csrf-token': token,
      });
      assert.equal(response.status, 302, response.body);
      assert.equal(response.headers.get('location'), '/');
      assert.deepEqual(database.audits, ['login.success']);
      assert.equal((await client.request('/admin/users')).status, 200);
    });

    for (const [name, body] of [
      ['unparsed body', 'unparsed'],
      ['empty JSON body', ''],
      ['malformed JSON', '{"username":'],
    ]) {
      it(`returns a controlled 400 for ${name} without authentication side effects`, async () => {
        const { client, token } = await anonymous();
        const response = await client.request('/login', body, {
          'content-type': name === 'unparsed body' ? 'text/plain' : 'application/json',
          'x-csrf-token': token,
        });
        assert.equal(response.status, 400, response.body);
        assert.equal(JSON.parse(response.body).statusCode, 400);
        assert.doesNotMatch(response.body, /stack|node_modules|TestPassword123/);
        assert.deepEqual(database.audits, []);
        assert.equal((await client.request('/')).status, 401);
      });
    }

    for (const body of [
      'username[role]=admin&password=TestPassword123',
      'username=test-admin&username=other&password=TestPassword123',
    ]) {
      it(`rejects non-scalar credential form input: ${body.split('&')[0]}`, async () => {
        const { client, token } = await anonymous();
        const response = await client.request('/login', body, {
          'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token,
        });
        assert.equal(response.status, 400, response.body);
        assert.deepEqual(database.audits, []);
      });
    }

    it('preserves JSON DTO whitelisting for authenticated administrator submissions', async () => {
      const { client, token } = await loggedIn();
      const response = await client.request('/admin/users', JSON.stringify({ ...newUser, unexpected: true }), {
        'content-type': 'application/json', 'x-csrf-token': token,
      });
      assert.equal(response.status, 400, response.body);
      assert.deepEqual(JSON.parse(response.body).message, ['property unexpected should not exist']);
      assert.equal(await database.findUserByUsername(newUser.username), null);
    });

    it('rejects oversized JSON with 413 and continues serving requests', async () => {
      const { client, token } = await anonymous();
      const response = await client.request('/login', JSON.stringify({ padding: 'x'.repeat(110000) }), {
        'content-type': 'application/json', 'x-csrf-token': token,
      });
      assert.equal(response.status, 413, response.body);
      assert.equal(JSON.parse(response.body).statusCode, 413);
      assert.deepEqual(database.audits, []);
      assert.equal((await client.request('/login')).status, 200);
    });

    it('uses scalar query error flags without reflecting input or accepting query credentials', async () => {
      const { client, token } = await anonymous();
      const page = await client.request('/login?error=%3Cscript%3Equery-marker%3C%2Fscript%3E');
      assert.equal(page.status, 200, page.body);
      assert.match(page.body, /Invalid username or password\./);
      assert.doesNotMatch(page.body, /query-marker/);
      const response = await client.request('/login?username=test-admin&password=TestPassword123', { _csrf: token });
      assert.equal(response.status, 400, response.body);
      assert.deepEqual(database.audits, []);
    });

    it('uses exact parameter routes and safely handles rejected async database calls', async () => {
      const { client } = await loggedIn();
      assert.equal((await client.request('/files/test%2Dfile')).status, 200);
      assert.equal((await client.request('/files/test-file/extra')).status, 404);
      assert.equal((await client.request('/files/nonexistent')).status, 404);
      database.fileLookupError = new Error('TEST_ONLY_DATABASE_FAILURE');
      const response = await client.request('/files/test-file');
      assert.equal(response.status, 500, response.body);
      assert.deepEqual(JSON.parse(response.body), { statusCode: 500, message: 'Internal server error' });
      assert.doesNotMatch(response.body, /TEST_ONLY_DATABASE_FAILURE|stack|node_modules/);
      assert.equal((await client.request('/login')).status, 200);
    });
  });
});
