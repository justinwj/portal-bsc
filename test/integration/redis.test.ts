import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';
import { CouchDbService } from '../../src/common/couchdb.service';
import { UserRole } from '../../src/common/roles';
import { UsersService } from '../../src/users/users.service';
import { browser, dependencyUrl, formToken, launchApplication, sessionId, unusedPort, within } from './support';

describe('real Redis 7 integration', { concurrency: false, timeout: 45000 }, () => {
  let client: ReturnType<typeof createClient>;
  let app: Awaited<ReturnType<typeof launchApplication>>;
  const credentials = { username: `ci-redis-${randomUUID()}`, password: 'TemporaryPassword123' };

  before(async () => {
    const redisUrl = dependencyUrl('REDIS_URL');
    dependencyUrl('COUCHDB_URL');
    client = createClient({ url: redisUrl, socket: { connectTimeout: 3000, reconnectStrategy: false } });
    client.on('error', () => undefined);
    await client.connect();
    const couch = new CouchDbService();
    await couch.initialize();
    await new UsersService(couch).createUser({ ...credentials, email: 'redis@example.test', role: UserRole.ADMIN });
    app = await launchApplication();
    await within(app.ready, 10000, 'Actual production application failed to become ready');
  });
  after(async () => {
    await app?.close();
    if (client?.isOpen) await client.quit();
  });

  it('connects to Redis and reports readiness', async () => {
    assert.equal(client.isReady, true);
    assert.equal(await client.ping(), 'PONG');
  });

  it('creates and retrieves real RedisStore sessions', async () => {
    const prefix = `ci:${randomUUID()}:`;
    const store = new RedisStore({ client, prefix });
    const id = randomUUID();
    const cookie = new session.Cookie();
    cookie.maxAge = 60000;
    const record = { cookie, user: { id: 'ci-user' } };
    try {
      await new Promise<void>((resolve, reject) => store.set(id, record, (error) => error ? reject(error) : resolve()));
      const raw = await client.get(`${prefix}${id}`);
      assert.ok(typeof raw === 'string');
      assert.equal(JSON.parse(raw).user.id, 'ci-user');
      const restored = await new Promise<any>((resolve, reject) => store.get(id, (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(restored.user.id, 'ci-user');
      const ttl = await client.ttl(`${prefix}${id}`);
      assert.ok(typeof ttl === 'number' && ttl > 0);
    } finally {
      await client.del(`${prefix}${id}`);
    }
  });

  async function login() {
    const http = browser(app.url);
    const page = await http.request('/login');
    assert.equal(page.status, 200, page.body);
    assert.match(page.headers.get('set-cookie') ?? '', /Secure/);
    const response = await http.request('/login', { ...credentials, _csrf: formToken(page.body) });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/');
    return http;
  }

  it('persists authenticated sessions between actual application requests', async () => {
    const http = await login();
    const id = sessionId(http.cookie);
    const raw = await client.get(`sess:${id}`);
    assert.ok(typeof raw === 'string', 'The production session must be present in actual Redis');
    assert.equal(JSON.parse(raw).user.username, credentials.username);
    for (const path of ['/', '/files', '/admin/users']) {
      const response = await http.request(path);
      assert.equal(response.status, 200, `${path}: ${response.body}`);
      assert.equal(sessionId(http.cookie), id);
    }
    const dashboard = await http.request('/');
    assert.equal(dashboard.status, 200, dashboard.body);
    assert.equal((await http.request('/logout', { _csrf: formToken(dashboard.body) })).status, 302);
  });

  it('deletes the Redis session on logout and rejects the saved session cookie', async () => {
    const http = await login();
    const cookie = http.cookie;
    const key = `sess:${sessionId(cookie)}`;
    assert.ok(await client.get(key));
    const dashboard = await http.request('/');
    assert.equal(dashboard.status, 200, dashboard.body);
    const response = await http.request('/logout', { _csrf: formToken(dashboard.body) });
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.get('location'), '/login');
    assert.equal(await client.get(key), null, 'Logout must delete the actual Redis key');
    for (const path of ['/', '/files', '/admin/users']) {
      const replay = await http.request(path, undefined, cookie);
      assert.equal(replay.status, 401, replay.body);
    }
  });

  it('fails startup promptly when Redis is unavailable instead of retrying forever', async () => {
    const unavailable = await launchApplication(`redis://127.0.0.1:${await unusedPort()}`);
    try {
      const code = await within(unavailable.exited, 8000, 'Application did not fail startup within 8 seconds when Redis was unavailable');
      assert.notEqual(code, 0, unavailable.output);
      assert.match(unavailable.output, /Redis session store failed to initialize/);
      assert.doesNotMatch(unavailable.output, /Portal-BSC listening on/);
    } finally {
      await unavailable.close();
    }
  });
});
