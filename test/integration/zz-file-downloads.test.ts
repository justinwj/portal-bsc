import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, it } from 'node:test';
import { CouchDbService, FileRecord } from '../../src/common/couchdb.service';
import { FilesService } from '../../src/files/files.service';
import { UsersService } from '../../src/users/users.service';
import { UserRole } from '../../src/common/roles';
import { browser, dependencyUrl, formToken, launchApplication, within } from './support';

const nano = require('nano');

describe('real HTTP file authorization and filesystem safety', { concurrency: false, timeout: 180000 }, () => {
  let directory: string;
  let root: string;
  let client: any;
  const metadata = new Map<string, FileRecord>();
  const users = new Map<UserRole, { username: string; password: string; id: string }>();
  const content = Buffer.from('Actual NAS fixture bytes\n\u0000\u00ff', 'utf8');
  const downloadIds = new Set<string>();

  before(async () => {
    dependencyUrl('REDIS_URL');
    client = nano(dependencyUrl('COUCHDB_URL'));
    directory = await mkdtemp(join(tmpdir(), 'portal-download-integration-'));
    root = join(directory, 'nas');
    await mkdir(root);
    await mkdir(join(root, 'directory'));
    const couch = new CouchDbService(); await couch.initialize();
    for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
      const credentials = { username: `download-${role}-${randomUUID()}`, password: 'DownloadPassword123' };
      const user = await new UsersService(couch).createUser({ ...credentials, email: `${role}@example.test`, role });
      users.set(role, { ...credentials, id: user._id });
    }
    for (const name of ['admin', 'member', 'empty', 'public', 'initial-error', 'late-error', 'denied']) {
      await writeFile(join(root, `${name}.pdf`), name === 'late-error' ? Buffer.alloc(1024 * 1024, 65) : content);
    }
    await chmod(join(root, 'denied.pdf'), 0);
    await writeFile(join(directory, 'outside.pdf'), 'OUTSIDE SECRET');
    await symlink(join(directory, 'outside.pdf'), join(root, 'escape.pdf'));
    const specs: [string, string, UserRole[], 'public' | 'private'][] = [
      ['admin', 'admin.pdf', [UserRole.ADMIN], 'private'],
      ['member', 'member.pdf', [UserRole.MEMBER], 'private'],
      ['empty', 'empty.pdf', [], 'private'], ['public', 'public.pdf', [], 'public'],
      ...['missing', 'directory', 'escape', 'initial-error', 'late-error', 'denied'].map((name) =>
        [name, name === 'directory' ? 'directory' : `${name}.pdf`, [], 'public'] as typeof specs[number]),
      ['traversal', '../public.pdf', [], 'public'],
    ];
    const files = new FilesService(couch);
    for (const [name, storedFilename, allowedRoles, visibility] of specs) {
      const file = await files.createSeedFile({ title: `download-${name}-${randomUUID()}`,
        description: `Confidential description for ${name} ${randomUUID()}`, storedFilename,
        originalFilename: 'NAS report.pdf', mimeType: 'application/pdf', sizeBytes: content.length,
        sha256: 'fixture', allowedRoles, visibility });
      metadata.set(name, file); downloadIds.add(file._id);
    }
  });
  after(async () => {
    if (directory) {
      await chmod(join(root, 'denied.pdf'), 0o600);
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function downloadAudits(fileId?: string) {
    const rows = (await client.use('portal_audit').list({ include_docs: true })).rows;
    return rows.map((row: any) => row.doc).filter((doc: any) => doc.event === 'file.download'
      && (fileId ? doc.details?.fileId === fileId : downloadIds.has(doc.details?.fileId)));
  }

  async function withApp(action: (app: Awaited<ReturnType<typeof launchApplication>>, http: ReturnType<typeof browser>) => Promise<void>, role?: UserRole, faults = false) {
    const app = await launchApplication(dependencyUrl('REDIS_URL'), { NAS_FILES_DIR: root,
      ...(faults ? { NODE_OPTIONS: '--require ./test/integration/fs-faults.cjs' } : {}) });
    try {
      await within(app.ready, 10000, 'Download application did not start');
      const http = browser(app.url);
      if (role) {
        const page = await http.request('/login');
        assert.equal(page.status, 200, page.body);
        const credentials = users.get(role);
        const login = await http.request('/login', { username: credentials.username,
          password: credentials.password, _csrf: formToken(page.body) });
        assert.equal(login.status, 302, login.body);
        assert.equal(login.headers.get('location'), '/');
      }
      await action(app, http);
    } finally { await app.close(); }
  }

  async function requestFile(app: { url: string }, http: ReturnType<typeof browser>, id: string) {
    return fetch(`${app.url}/download/${id}`, { headers: { cookie: http.cookie, 'x-forwarded-proto': 'https' },
      redirect: 'manual', signal: AbortSignal.timeout(5000) });
  }

  for (const [role, name] of [[UserRole.MEMBER, 'admin'], [UserRole.ADMIN, 'empty']] as const) {
    it(`hides unauthorized ${name} file details from ${role} without exposing metadata`, async () => {
      const file = metadata.get(name);
      await withApp(async (_app, http) => {
        const response = await http.request(`/files/${file._id}`);
        assert.equal(response.status, 404, response.body);
        for (const value of [file._id, file.title, file.description, file.storedFilename, file.originalFilename, file.sha256]) {
          assert.ok(!response.body.includes(value), `Unauthorized response exposed ${value}`);
        }
      }, role);
    });
  }

  for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
    it(`renders authorized file details for ${role}`, async () => {
      const file = metadata.get(role);
      await withApp(async (_app, http) => {
        const response = await http.request(`/files/${file._id}`);
        assert.equal(response.status, 200, response.body);
        assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
        assert.ok(response.body.includes(file.title));
        assert.ok(response.body.includes(file.description));
        assert.ok(response.body.includes(file.mimeType));
        assert.ok(response.body.includes(file.sha256));
        assert.ok(response.body.includes(`/download/${file._id}`));
      }, role);
    });
  }

  it('rejects unauthenticated downloads without a download audit', async () => {
    const file = metadata.get('public');
    const before = await downloadAudits(file._id);
    await withApp(async (app, http) => {
      const response = await requestFile(app, http, file._id);
      assert.equal(response.status, 401);
      assert.doesNotMatch(await response.text(), /Actual NAS fixture|OUTSIDE SECRET/);
    });
    assert.deepEqual(await downloadAudits(file._id), before);
  });

  for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
    for (const name of [role, 'public']) {
      it(`streams authorized ${name} files to ${role} with correct headers, bytes and audit`, async () => {
        const file = metadata.get(name);
        const before = await downloadAudits(file._id);
        const existingIds = new Set(before.map((audit: any) => audit._id));
        await withApp(async (app, http) => {
          const response = await requestFile(app, http, file._id);
          assert.equal(response.status, 200);
          assert.match(response.headers.get('content-type') ?? '', /^application\/pdf/);
          assert.equal(response.headers.get('content-length'), String(content.length));
          assert.equal(response.headers.get('content-disposition'), 'attachment; filename="NAS%20report.pdf"');
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
          // Allow the server's completed-transfer audit write to finish.
          const until = Date.now() + 3000;
          while ((await downloadAudits(file._id)).length === before.length && Date.now() < until) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          const audits = await downloadAudits(file._id);
          assert.equal(audits.length, before.length + 1);
          const added = audits.filter((audit: any) => !existingIds.has(audit._id));
          assert.equal(added.length, 1);
          assert.equal(added[0].userId, users.get(role).id);
        }, role);
      });
    }
    for (const name of [role === UserRole.ADMIN ? 'member' : 'admin', 'empty']) {
      it(`rejects ${role} access to valid but unauthorized ${name} file IDs`, async () => {
        const file = metadata.get(name);
        const before = await downloadAudits(file._id);
        await withApp(async (app, http) => {
          const response = await requestFile(app, http, file._id);
          assert.equal(response.status, 404);
          assert.doesNotMatch(await response.text(), /Actual NAS fixture|OUTSIDE SECRET/);
        }, role);
        assert.deepEqual(await downloadAudits(file._id), before);
      });
    }
  }

  it('returns a controlled not-found response for nonexistent metadata IDs', async () => {
    const before = await downloadAudits();
    await withApp(async (app, http) => {
      const response = await requestFile(app, http, randomUUID());
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /Actual NAS fixture|OUTSIDE SECRET/);
    }, UserRole.ADMIN);
    assert.deepEqual(await downloadAudits(), before);
  });

  it('preserves download parameter decoding, exact route matching and malformed-URL error handling', async () => {
    const file = metadata.get('public');
    await withApp(async (app, http) => {
      const encodedId = file._id.replace('-', '%2D');
      const response = await requestFile(app, http, encodedId);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
      for (const [id, status] of [[`${file._id}/extra`, 404], ['%E0%A4%A', 400]] as const) {
        const rejected = await requestFile(app, http, id);
        assert.equal(rejected.status, status);
        const body = await rejected.text();
        assert.ok(!body.includes(file.title));
        assert.ok(!body.includes(root));
        assert.doesNotMatch(body, /Actual NAS fixture|OUTSIDE SECRET/);
      }
      assert.equal((await http.request('/healthz')).status, 200);
    }, UserRole.MEMBER);
  });

  for (const name of ['missing', 'directory', 'traversal', 'escape', 'denied']) {
    it(`rejects ${name} filesystem access without data leakage, successful audit, or process crash`, async () => {
      const file = metadata.get(name);
      const before = await downloadAudits(file._id);
      await withApp(async (app, http) => {
        const response = await requestFile(app, http, file._id);
        assert.equal(response.status, 404);
        const body = await response.text();
        assert.doesNotMatch(body, /Actual NAS fixture|OUTSIDE SECRET/);
        assert.ok(!body.includes(directory), 'Responses must not expose filesystem paths');
        assert.equal((await http.request('/healthz')).status, 200);
      }, UserRole.ADMIN);
      assert.deepEqual(await downloadAudits(file._id), before);
    });
  }

  it('returns a controlled error for an initial stream read failure and keeps serving requests', async () => {
    const file = metadata.get('initial-error');
    const before = await downloadAudits(file._id);
    await withApp(async (app, http) => {
      const response = await requestFile(app, http, file._id);
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.ok(!body.includes(root));
      assert.doesNotMatch(body, /Injected test|Actual NAS fixture/);
      assert.equal((await http.request('/healthz')).status, 200);
      assert.match(app.output, /Injected test filesystem EIO/);
    }, UserRole.ADMIN, true);
    assert.deepEqual(await downloadAudits(file._id), before);
  });

  it('aborts a partially failed stream rather than completing or auditing a successful download', async () => {
    const file = metadata.get('late-error');
    const before = await downloadAudits(file._id);
    await withApp(async (app, http) => {
      await assert.rejects(async () => {
        const response = await requestFile(app, http, file._id);
        await response.arrayBuffer();
      });
      assert.match(app.output, /Injected test filesystem EIO/);
      assert.deepEqual(await downloadAudits(file._id), before);
      assert.equal((await http.request('/healthz')).status, 200);
    }, UserRole.ADMIN, true);
    assert.deepEqual(await downloadAudits(file._id), before);
  });
});
