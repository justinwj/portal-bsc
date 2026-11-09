import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function dependencyUrl(name: 'REDIS_URL' | 'COUCHDB_URL') {
  assert.equal(process.env.INTEGRATION_TESTS, '1', 'Dependency tests require explicit opt-in');
  const value = process.env[name];
  assert.ok(value, `${name} must explicitly identify a temporary local service`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Only local disposable services are allowed');
  if (name === 'COUCHDB_URL') assert.equal(url.username, 'ci-admin', 'Use the test-only CouchDB administrator');
  return value;
}

export async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function launchApplication(redisUrl = dependencyUrl('REDIS_URL'), overrides: NodeJS.ProcessEnv = {}) {
  const port = await unusedPort();
  const directory = await mkdtemp(join(tmpdir(), 'portal-bsc-integration-'));
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SESSION_SECRET: randomUUID(),
      ALLOW_IN_MEMORY_SESSION_STORE: 'false',
      REDIS_URL: redisUrl,
      COUCHDB_URL: dependencyUrl('COUCHDB_URL'),
      NAS_FILES_DIR: directory,
      NAS_FILES_HOST_PATH: directory,
      ADMIN_USERNAME: 'ci-admin',
      ADMIN_EMAIL: 'ci-admin@example.test',
      ADMIN_PASSWORD: 'TemporaryPassword123',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let startupResolve: () => void;
  let startupReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  // Failure tests inspect process exit directly rather than awaiting readiness.
  ready.catch(() => undefined);
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes('Portal-BSC listening on')) startupResolve();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', (error) => { startupReject(error); resolve(null); });
    child.once('close', (code) => {
      startupReject(new Error(`Application exited before readiness: ${output}`));
      resolve(code);
    });
  });
  return {
    ready, exited, url: `http://127.0.0.1:${port}`,
    get output() { return output; },
    crash() { child.kill('SIGKILL'); },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer!);
  }
}

export function browser(baseUrl: string) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(path: string, body?: Record<string, string>, savedCookie?: string) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        // Exercise production secure-session handling behind the configured trusted proxy.
        headers: { 'x-forwarded-proto': 'https', cookie: savedCookie ?? cookie },
        body: body === undefined ? undefined : new URLSearchParams(body),
        redirect: 'manual', signal: AbortSignal.timeout(5000),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, headers: response.headers, body: await response.text() };
    },
  };
}

export function formToken(html: string) {
  const token = /name="_csrf" value="([a-f0-9]{64})"/.exec(html)?.[1];
  assert.ok(token, 'The actual rendered page must supply a CSRF token');
  return token;
}

export function sessionId(cookie: string) {
  const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  assert.ok(signed.startsWith('s:'), 'Expected a signed session cookie');
  return signed.slice(2, signed.lastIndexOf('.'));
}
