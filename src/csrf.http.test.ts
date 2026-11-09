/// <reference path="./types/express.d.ts" />
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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
  async getPortalSettings() { return null; }
  readonly users = new Map<string, UserRecord>();
  readonly audits: string[] = [];
  readonly additionalFiles = new Map<string, FileRecord>();
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
    return [this.file, ...this.additionalFiles.values()];
  }

  async findFileById(id: string) {
    if (this.fileLookupError) throw this.fileLookupError;
    return id === this.file._id ? this.file : this.additionalFiles.get(id) ?? null;
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
  let viewDirectory: string;

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
    // Exercise the production renderer on copies of the actual templates. A
    // test-owned disk partial covers discovery without adding product markup.
    viewDirectory = await mkdtemp(join(tmpdir(), 'portal-view-test-'));
    await cp(join(process.cwd(), 'views'), join(viewDirectory, 'views'), { recursive: true });
    await mkdir(join(viewDirectory, 'views/partials'), { recursive: true });
    await writeFile(join(viewDirectory, 'views/partials/rendering-probe.hbs'),
      '<aside data-rendering-probe>{{#if (eq user.role "admin")}}administrator{{else}}other{{/if}}</aside>');
    const layoutPath = join(viewDirectory, 'views/layouts/main.hbs');
    const layout = await readFile(layoutPath, 'utf8');
    await writeFile(layoutPath, layout.replace('</main>', '{{> rendering-probe}}</main>'));
    const originalDirectory = process.cwd();
    try {
      // configureViews resolves fixed paths synchronously, before any requests.
      process.chdir(viewDirectory);
      configureViews(app);
    } finally { process.chdir(originalDirectory); }
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
    database.additionalFiles.clear();
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
      if (viewDirectory) {
        assert.equal(dirname(viewDirectory), resolve(tmpdir()));
        assert.ok(basename(viewDirectory).startsWith('portal-view-test-'));
        await rm(viewDirectory, { recursive: true, force: true });
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

  describe('rendering security HTTP characterization', () => {
    it('renders the login page with the configured layout, discovered partial and working CSRF form', async () => {
      const client = browser();
      const page = await client.request('/login');
      assert.equal(page.status, 200, page.body);
      assert.match(page.body, /<!DOCTYPE html>/);
      assert.match(page.body, /<title>Login<\/title>/);
      assert.match(page.body, /href="\/css\/styles.css"/);
      assert.match(page.body, /<aside data-rendering-probe>other<\/aside>/);
      const token = await getToken(client);
      const login = await client.request('/login', { ...credentials, _csrf: token });
      assert.equal(login.status, 302, login.body);
      assert.equal((await client.request('/')).status, 200);
    });

    for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
      it(`renders ${role} helpers and authorized file records without leaking other roles' metadata`, async () => {
        for (const name of ['admin', 'member', 'public', 'empty']) {
          database.additionalFiles.set(`render-${name}`, { ...database.file, _id: `render-${name}`,
            title: `Render ${name} title`, description: `Render ${name} description`,
            visibility: name === 'public' ? 'public' : 'private',
            allowedRoles: name === 'admin' ? [UserRole.ADMIN] : name === 'member' ? [UserRole.MEMBER] : [] });
        }
        const { client } = await loggedIn(role);
        const dashboard = await client.request('/');
        assert.equal(dashboard.status, 200, dashboard.body);
        assert.ok(dashboard.body.includes(`<aside data-rendering-probe>${role === UserRole.ADMIN ? 'administrator' : 'other'}</aside>`));
        const files = await client.request('/files');
        assert.equal(files.status, 200, files.body);
        for (const name of ['admin', 'member', 'public', 'empty']) {
          const file = database.additionalFiles.get(`render-${name}`);
          if (name === role || name === 'public') {
            assert.ok(files.body.includes(file.title));
            assert.ok(files.body.includes(`/files/${file._id}`));
            const details = await client.request(`/files/${file._id}`);
            assert.equal(details.status, 200, details.body);
            assert.ok(details.body.includes(file.description));
          } else {
            assert.ok(!files.body.includes(file.title));
            assert.ok(!files.body.includes(file._id));
            assert.ok(!dashboard.body.includes(file.title));
            const denied = await client.request(`/files/${file._id}`);
            assert.equal(denied.status, 404, denied.body);
            assert.ok(!denied.body.includes(file.title));
            assert.ok(!denied.body.includes(file.description));
          }
        }
      });
    }

    it('HTML-escapes untrusted file metadata in lists, details and layout titles', async () => {
      const file = { ...database.file, _id: 'escaped-file', title: '<script>title&</script>',
        description: '<img>description&', category: '<b>category&</b>', mimeType: '<i>type&</i>', sha256: '<u>hash&</u>' };
      database.additionalFiles.set(file._id, file);
      const { client } = await loggedIn();
      const escaped = { title: '&lt;script&gt;title&amp;&lt;/script&gt;', description: '&lt;img&gt;description&amp;',
        category: '&lt;b&gt;category&amp;&lt;/b&gt;', mimeType: '&lt;i&gt;type&amp;&lt;/i&gt;', sha256: '&lt;u&gt;hash&amp;&lt;/u&gt;' };
      for (const path of ['/files', `/files/${file._id}`]) {
        const page = await client.request(path);
        assert.equal(page.status, 200, page.body);
        for (const field of path === '/files' ? ['title', 'category', 'mimeType'] : Object.keys(escaped)) {
          assert.ok(page.body.includes(escaped[field]), `Missing escaped ${field} on ${path}`);
          assert.ok(!page.body.includes(file[field]), `Unescaped ${field} on ${path}`);
        }
      }
    });

    it('HTML-escapes untrusted usernames on the dashboard and administrator page', async () => {
      const { client } = await loggedIn();
      const user = await database.findUserByUsername(credentials.username);
      user.username = '<svg>account&</svg>';
      for (const path of ['/', '/admin/users']) {
        const page = await client.request(path);
        assert.equal(page.status, 200, page.body);
        assert.match(page.body, /&lt;svg&gt;account&amp;&lt;\/svg&gt;/);
        assert.ok(!page.body.includes(user.username));
      }
    });

    for (const fault of ['missing template', 'invalid partial']) {
      it(`returns a controlled rendering error for a ${fault} without leaking server paths`, async () => {
        const path = join(viewDirectory, 'views', fault === 'missing template' ? 'login.hbs' : 'partials/rendering-probe.hbs');
        const original = await readFile(path, 'utf8');
        try {
          if (fault === 'missing template') await rename(path, `${path}.missing`);
          else await writeFile(path, '{{#if}}');
          const response = await browser().request('/login');
          assert.equal(response.status, 500, response.body);
          assert.deepEqual(JSON.parse(response.body), { statusCode: 500, message: 'Internal server error' });
          assert.ok(!response.body.includes(viewDirectory));
          assert.ok(!response.body.includes(process.cwd()));
          assert.doesNotMatch(response.body, /node_modules|ENOENT|Failed to lookup|Parse error|stack/);
        } finally {
          if (fault === 'missing template') await rename(`${path}.missing`, path);
          else await writeFile(path, original);
        }
        assert.equal((await browser().request('/login')).status, 200);
      });
    }
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
