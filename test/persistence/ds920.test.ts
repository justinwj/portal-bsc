import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { request } from 'node:https';
import { request as requestHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { before, after, describe, it } from 'node:test';
import { formToken } from '../integration/support';

const exec = promisify(execFile), yaml = require('js-yaml'), nano = require('nano'), bcrypt = require('bcrypt');

// Disposable model of the supplied implicit-default-network infrastructure.
// NAS identities/paths are checked by config parsing only, never instantiated.
describe('DS920 additive deployment with existing bind-backed infrastructure', { concurrency: false, timeout: 240000 }, () => {
  const project = `portal-7h-${randomUUID()}`, storageId = randomUUID();
  const password = 'DisposableDeploymentPassword123';
  let directory: string, base: string, envFile: string, proxyPort: number, client: any;
  let attempted = false, fileId: string, originalIds: string[], originalProxyId: string, beforeUser: any;
  let activeProxyConfig: string;
  const bytes = Buffer.from('disposable private deployment fixture');
  const overlay = resolve('deploy/ds920/compose.app.yml');

  function compose(args: string[], merged = true, extra: Record<string, string> = {}) {
    return exec('docker', ['compose', '-p', project, '--env-file', envFile, '-f', base,
      ...(merged ? ['-f', overlay] : []), ...args], {
      env: { ...process.env, ...extra }, timeout: 90000, maxBuffer: 1024 * 1024,
    });
  }
  async function eventually(check: () => Promise<void>, label: string) {
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      try { await check(); return; } catch { await new Promise(r => setTimeout(r, 250)); }
    }
    throw new Error(`Timed out: ${label}`); // Never print configuration/credentials on failure.
  }
  function http(path: string, options: { method?: string; cookie?: string; body?: string | Buffer; headers?: Record<string, string> } = {}) {
    return new Promise<{ status: number; headers: any; body: string; bytes: Buffer }>((resolveResult, reject) => {
      const req = request({ hostname: '127.0.0.1', port: proxyPort, path, method: options.method ?? 'GET',
        rejectUnauthorized: false, // ONLY this isolated self-signed test listener.
        headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => { const data = Buffer.concat(chunks); resolveResult({ status: res.statusCode!, headers: res.headers, body: data.toString(), bytes: data }); });
        res.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTPS test deadline')));
      req.end(options.body);
    });
  }
  async function login(username = 'existing-admin') {
    const page = await http('/login'), cookie = page.headers['set-cookie'][0].split(';')[0];
    assert.match(page.headers['set-cookie'][0], /; Secure/i);
    const result = await http('/login', { method: 'POST', cookie,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password, _csrf: formToken(page.body) }).toString() });
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, '/');
    const activeCookie = result.headers['set-cookie']?.[0].split(';')[0] ?? cookie;
    const dashboard = await http('/', { cookie: activeCookie }); assert.equal(dashboard.status, 200);
    return { cookie: activeCookie, csrf: formToken(dashboard.body) };
  }
  function json(actor: Awaited<ReturnType<typeof login>>, path: string, body: any) {
    return http(path, { method: 'POST', cookie: actor.cookie, headers: { 'content-type': 'application/json', 'x-csrf-token': actor.csrf }, body: JSON.stringify(body) });
  }
  async function ids() {
    return Promise.all(['couchdb', 'redis'].map(async service => (await compose(['ps', '-q', service])).stdout.trim()));
  }
  async function connectToFixtureDatabase() {
    const port = Number((await compose(['port', 'couchdb', '5984'], false)).stdout.trim().split(':').pop());
    client = nano({ url: `http://127.0.0.1:${port}`, requestDefaults: { auth: { username: 'ci-admin', password } } });
    await eventually(async () => assert.equal((await client.session()).userCtx.name, 'ci-admin'), 'existing database readiness');
  }
  async function ready() { await eventually(async () => assert.equal((await http('/healthz')).status, 200), 'TLS proxy and app readiness'); }

  before(async () => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use disposable GitHub-hosted Linux resources');
    assert.equal(process.env.INTEGRATION_TESTS, '1');
    directory = await mkdtemp(join(tmpdir(), 'portal-7h-'));
    for (const d of ['data', 'config', 'files', 'logs', 'managed', 'tls']) await mkdir(join(directory, d));
    // Explicit permissions ONLY on positively owned CI fixtures.
    for (const d of ['data', 'config', 'logs']) await chmod(join(directory, d), 0o777);
    for (const d of ['staging', 'objects', 'quarantine']) await mkdir(join(directory, 'managed', d), { mode: 0o700 });
    await writeFile(join(directory, 'managed/.portal-storage.json'), JSON.stringify({ schemaVersion: 1, id: storageId }), { mode: 0o600 });
    await writeFile(join(directory, 'files/sentinel.txt'), 'existing read-only data');
    await writeFile(join(directory, 'config/10-single-node.ini'), '[couchdb]\nsingle_node=true\n');
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-keyout', join(directory, 'tls/tls.key'), '-out', join(directory, 'tls/tls.crt')]);
    base = join(directory, 'existing.yml'); envFile = join(directory, 'protected.env');
    activeProxyConfig = join(directory, 'nginx.conf');
    await writeFile(activeProxyConfig, await readFile(resolve('deploy/ds920/nginx.original-placeholder.conf')));
    const bind = (source: string, target: string, read_only = false) => ({ type: 'bind', source, target, read_only, bind: { create_host_path: false } });
    // Production candidate inherits the original services; only this CI model
    // supplies their definitions and temporary loopback diagnostics ports.
    await writeFile(base, yaml.dump({ services: {
      couchdb: { image: 'couchdb:3', environment: { COUCHDB_USER: 'ci-admin', COUCHDB_PASSWORD: password },
        volumes: [bind(join(directory, 'data'), '/opt/couchdb/data'), bind(join(directory, 'config'), '/opt/couchdb/etc/local.d')],
        ports: ['127.0.0.1::5984'] },
      redis: { image: 'redis:7-alpine', command: ['redis-server', '--save', '', '--appendonly', 'no'] },
      nginx: { image: 'nginx:stable-alpine', ports: ['127.0.0.1::443', '127.0.0.1::80'], depends_on: ['couchdb', 'redis'],
        volumes: [bind(activeProxyConfig, '/etc/nginx/nginx.conf', true),
          bind(join(directory, 'tls'), '/etc/nginx/portal-tls', true), bind(join(directory, 'logs'), '/var/log/nginx')] },
    } }));
    const imageId = (await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', 'portal-bsc:ci'])).stdout.trim();
    assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
    await writeFile(envFile, [ `PORTAL_APP_IMAGE=${imageId}`,
      `PORTAL_APP_UID=${process.getuid!()}`, `PORTAL_APP_GID=${process.getgid!()}`,
      `SESSION_SECRET=${randomUUID()}`, 'PORTAL_COUCHDB_URL=http://couchdb:5984', 'COUCHDB_USER=ci-admin',
      `COUCHDB_PASSWORD=${password}`, 'PORTAL_REDIS_URL=redis://redis:6379', `NAS_FILES_HOST_PATH=${join(directory, 'files')}`,
      `PORTAL_UPLOADS_HOST_PATH=${join(directory, 'managed')}`, `PORTAL_UPLOADS_STORAGE_ID=${storageId}`,
      'PORTAL_UPLOAD_MIN_FREE_BYTES=1048576',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    attempted = true;
    await compose(['up', '-d', 'nginx', 'couchdb', 'redis'], false);
    originalProxyId = (await compose(['ps', '-q', 'nginx'], false)).stdout.trim();
    await connectToFixtureDatabase();
    for (const db of ['portal_users', 'portal_files', 'portal_audit', 'portal_downloads']) await client.db.create(db);
    for (const [id, role] of [['existing-admin', 'admin'], ['existing-member', 'member']]) {
      await client.use('portal_users').insert({ _id: id, type: 'user', username: id, email: `${id}@example.test`,
        role, isActive: true, passwordHash: await bcrypt.hash(password, 4), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    beforeUser = await client.use('portal_users').get('existing-admin');
    await client.use('portal_audit').insert({ _id: 'existing-history', type: 'audit', event: 'test.preexisting', createdAt: new Date().toISOString() });
    originalIds = await ids();
  });

  after(async () => {
    try {
      if (attempted) await compose(['down', '--timeout', '15']); // Never remove volumes.
    } finally {
      // Retain bind-backed database files rather than changing CouchDB ownership
      // or deleting a database for cleanup. The disposable hosted VM expires.
      if (directory) assert.ok(directory.startsWith(join(tmpdir(), 'portal-7h-')));
    }
  });

  it('merges without changing existing CouchDB binds, credentials or Redis definition', async () => {
    const old = JSON.parse((await compose(['config', '--format', 'json'], false)).stdout);
    const merged = JSON.parse((await compose(['config', '--format', 'json'])).stdout);
    // Boolean assertions avoid dumping expanded secrets on a mismatch.
    for (const service of ['couchdb', 'redis', 'nginx']) assert.ok(JSON.stringify(old.services[service]) === JSON.stringify(merged.services[service]), `Preserve existing ${service} definition`);
    assert.ok(!merged.volumes);
    assert.ok(!merged.services.app.ports);
    assert.equal(merged.services.couchdb.volumes.find((m: any) => m.target === '/opt/couchdb/data').source, join(directory, 'data'));
    for (const name of ['nginx', 'couchdb', 'redis', 'app']) assert.deepEqual(Object.keys(merged.services[name].networks), ['default']);
  });
  it('reconciles the supplied NAS paths, identities and loopback bindings without executing a NAS stack', async () => {
    const result = await exec('docker', ['compose', '-p', 'portal', '--env-file', envFile,
      '-f', resolve('deploy/ds920/compose.infrastructure.yml'), '-f', overlay, 'config', '--format', 'json'],
      { timeout: 15000, maxBuffer: 1024 * 1024 });
    const config = JSON.parse(result.stdout);
    assert.equal(config.name, 'portal'); assert.ok(!config.volumes);
    assert.equal(config.services.nginx.container_name, 'portal-nginx');
    assert.equal(config.services.nginx.ports[0].published, '8088');
    assert.equal(config.services.nginx.ports[0].target, 80);
    for (const name of ['couchdb', 'redis']) assert.equal(config.services[name].ports[0].host_ip, '127.0.0.1');
    assert.equal(config.services.couchdb.volumes.find((m: any) => m.target === '/opt/couchdb/data').source, '/volume1/docker/portal/couchdb/data');
    assert.equal(config.services.couchdb.volumes.find((m: any) => m.target === '/opt/couchdb/etc/local.d').source, '/volume1/docker/portal/couchdb/config');
    for (const name of ['nginx', 'couchdb', 'redis', 'app']) assert.deepEqual(Object.keys(config.services[name].networks), ['default']);
    assert.equal(Object.keys(config.networks).length, 1);
    assert.ok(!config.services.app.ports);
  });
  it('starts the fourth container without recreating CouchDB/Redis or changing existing accounts/history', async () => {
    await compose(['up', '-d', '--no-deps', 'app']);
    assert.deepEqual(await ids(), originalIds);
    assert.deepEqual(await client.use('portal_users').get('existing-admin'), beforeUser);
    assert.equal((await client.use('portal_audit').get('existing-history')).event, 'test.preexisting');
    assert.equal((await compose(['ps', '-q', 'nginx'])).stdout.trim(), originalProxyId);
    await writeFile(activeProxyConfig, await readFile(resolve('deploy/ds920/nginx.conf')));
    await compose(['exec', '-T', 'nginx', 'nginx', '-t']);
    await compose(['exec', '-T', 'nginx', 'nginx', '-s', 'reload']);
    proxyPort = Number((await compose(['port', 'nginx', '443'])).stdout.trim().split(':').pop());
    await ready();
    await compose(['exec', '-T', 'nginx', 'nginx', '-t']);
    const version = (await compose(['exec', '-T', 'nginx', 'nginx', '-v'])).stderr.trim();
    assert.match(version, /^nginx version: nginx\/\d+\.\d+\.\d+$/);
    console.log(`Disposable proxy ${version}`);
  });
  it('routes TLS login/session/CSRF and rejects unauthenticated downloads and spoofed forwarding', async () => {
    const page = await http('/login', { headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '198.51.100.1' } });
    assert.equal(page.status, 200); assert.match(page.headers['set-cookie'][0], /; Secure/i);
    assert.equal((await http('/download/nonexistent')).status, 401);
    const a = await login();
    assert.equal((await json({ ...a, csrf: 'invalid' }, '/uploads/intents', {})).status, 403);
  });
  it('preserves private upload bytes through Nginx and enforces configured quota', async () => {
    const a = await login();
    const settings = await http('/admin/settings', { method: 'POST', cookie: a.cookie, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ maxActiveUsers: 'unlimited', defaultUserQuotaGb: '1', globalStorageGb: '1', _csrf: a.csrf }).toString() });
    assert.equal(settings.status, 303);
    const policy = await http('/admin/settings/uploads', { method: 'POST', cookie: a.cookie, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ maxUploadGb: '1', confirm: 'yes', _csrf: a.csrf }).toString() });
    assert.equal(policy.status, 303);
    const intent = await json(a, '/uploads/intents', { originalFilename: 'deployment.txt', title: 'Private fixture', description: '', sizeBytes: String(bytes.length), idempotencyKey: randomUUID() });
    assert.equal(intent.status, 201, intent.body); fileId = JSON.parse(intent.body).id;
    const upload = await http(`/uploads/${fileId}/content`, { method: 'PUT', cookie: a.cookie, headers: { 'x-csrf-token': a.csrf, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes });
    assert.equal(upload.status, 200, upload.body);
    const download = await http(`/download/${fileId}`, { cookie: a.cookie });
    assert.equal(download.status, 200); assert.deepEqual(download.bytes, bytes);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    const file = await client.use('portal_files').get(fileId);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(file.sharedWithUserIds, []);
    const excess = await json(a, '/uploads/intents', { originalFilename: 'too-large.txt', title: 'excess', description: '', sizeBytes: '1000000000', idempotencyKey: randomUUID() });
    assert.equal(excess.status, 409, excess.body);
  });
  it('does not expose private metadata or permit direct Nginx NAS-file access', async () => {
    assert.ok(fileId);
    const member = await login('existing-member');
    assert.equal((await http(`/files/${fileId}`, { cookie: member.cookie })).status, 404);
    assert.equal((await http(`/download/${fileId}`, { cookie: member.cookie })).status, 404);
    assert.equal((await http('/sentinel.txt', { cookie: member.cookie })).status, 404);
    const appId = (await compose(['ps', '-q', 'app'])).stdout.trim();
    const app = JSON.parse((await exec('docker', ['inspect', appId])).stdout)[0];
    assert.equal(app.Mounts.find((m: any) => m.Destination === '/var/lib/portal-bsc/files').RW, false);
    assert.equal(app.Mounts.find((m: any) => m.Destination === '/var/lib/portal-bsc/uploads').RW, true);
    assert.deepEqual(app.HostConfig.PortBindings, {});
    assert.equal(await readFile(join(directory, 'files/sentinel.txt'), 'utf8'), 'existing read-only data');
  });
  it('enforces selective sharing and revocation through the TLS proxy without copying bytes', async () => {
    const owner = await login(), member = await login('existing-member');
    const previous = await client.use('portal_files').get(fileId);
    assert.equal((await json(owner, `/files/${fileId}/sharing`, { recipientIds: ['existing-member'] })).status, 303);
    assert.deepEqual((await http(`/download/${fileId}`, { cookie: member.cookie })).bytes, bytes);
    assert.equal((await json(owner, `/files/${fileId}/sharing`, { recipientIds: [] })).status, 303);
    assert.equal((await http(`/download/${fileId}`, { cookie: member.cookie })).status, 404);
    const current = await client.use('portal_files').get(fileId);
    assert.equal(current.storedFilename, previous.storedFilename);
    assert.equal(current.sizeBytes, previous.sizeBytes);
    assert.deepEqual(current.sharedWithUserIds, []);
  });
  it('recovers a durable unused reservation and private committed data after app recreation', async () => {
    const a = await login();
    const pending = await json(a, '/uploads/intents', { originalFilename: 'interrupted.txt', title: 'interrupted', description: '', sizeBytes: '10', idempotencyKey: randomUUID() });
    assert.equal(pending.status, 201);
    const pendingId = JSON.parse(pending.body).id;
    await compose(['up', '-d', '--no-deps', '--force-recreate', 'app']); await ready();
    const actor = await login();
    assert.deepEqual((await http(`/download/${fileId}`, { cookie: actor.cookie })).bytes, bytes);
    const recovered = await client.use('portal_files').get(pendingId);
    assert.equal(recovered.upload.state, 'aborted');
    assert.deepEqual(await ids(), originalIds);
  });
  it('retains database bind data after CouchDB recreation and a fresh application start', async () => {
    await compose(['up', '-d', '--no-deps', '--force-recreate', 'couchdb']);
    await connectToFixtureDatabase();
    await compose(['up', '-d', '--no-deps', '--force-recreate', 'app']); await ready();
    assert.deepEqual(await client.use('portal_users').get('existing-admin'), beforeUser);
    assert.equal((await client.use('portal_audit').get('existing-history')).event, 'test.preexisting');
    assert.deepEqual((await http(`/download/${fileId}`, { cookie: (await login()).cookie })).bytes, bytes);
  });
  it('reloads the HTTP routing proposal in the same Nginx container without changing its host binding or trusting HTTPS claims', async () => {
    const containerId = (await compose(['ps', '-q', 'nginx'])).stdout.trim();
    const infrastructureIds = await ids();
    const binding = (await compose(['port', 'nginx', '80'])).stdout.trim();
    const port = Number(binding.split(':').pop());
    // Both listeners have disposable ports from the start. This is not a NAS
    // port change or an assertion that the uninspected mapping is 8088 -> 80.
    await writeFile(activeProxyConfig, await readFile(resolve('deploy/ds920/nginx.http-proposal.conf')));
    await compose(['exec', '-T', 'nginx', 'nginx', '-t']);
    await compose(['exec', '-T', 'nginx', 'nginx', '-s', 'reload']);
    function plain(path: string, headers: Record<string, string> = {}) {
      return new Promise<{status: number; headers: any; body: string}>((resolveResult, reject) => {
        const req = requestHttp({ hostname: '127.0.0.1', port, path, headers }, res => {
          const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolveResult({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
          res.on('error', reject);
        });
        req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTP routing deadline'))); req.end();
      });
    }
    await eventually(async () => assert.equal((await plain('/healthz')).status, 200), 'HTTP routing after reload');
    for (const headers of [{}, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' }]) {
      const page = await plain('/login', headers);
      assert.equal(page.status, 200); assert.ok(formToken(page.body));
      assert.equal(page.headers['set-cookie'], undefined, 'Plain HTTP must not acquire a production Secure-cookie session');
    }
    assert.equal((await plain(`/download/${fileId}`)).status, 401);
    assert.equal((await plain('/sentinel.txt')).status, 404);
    assert.equal((await compose(['ps', '-q', 'nginx'])).stdout.trim(), containerId);
    assert.equal(containerId, originalProxyId);
    assert.equal((await compose(['port', 'nginx', '80'])).stdout.trim(), binding);
    assert.deepEqual(await ids(), infrastructureIds);
    assert.deepEqual(await client.use('portal_users').get('existing-admin'), beforeUser);
  });
});
