import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, it } from 'node:test';
import { browser, dependencyUrl, launchApplication, within } from './support';

describe('production NAS startup preflight', { concurrency: false, timeout: 90000 }, () => {
  let directory: string;
  let denied: string;
  let readOnly: string;
  before(async () => {
    dependencyUrl('REDIS_URL'); dependencyUrl('COUCHDB_URL');
    assert.notEqual(process.getuid(), 0, 'Permission checks require the unprivileged GitHub runner user');
    directory = await mkdtemp(join(tmpdir(), 'portal-nas-preflight-'));
    denied = join(directory, 'denied'); readOnly = join(directory, 'read-only');
    await mkdir(denied); await mkdir(readOnly);
    await chmod(denied, 0); await chmod(readOnly, 0o555);
    await writeFile(join(directory, 'not-a-directory'), 'fixture');
  });
  after(async () => {
    if (directory) {
      await chmod(denied, 0o700); await chmod(readOnly, 0o700);
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (const kind of ['missing configuration', 'nonexistent directory', 'regular file', 'inaccessible directory', 'relative path']) {
    it(`rejects ${kind} in production without creating a replacement`, async () => {
      const absent = join(directory, 'absent');
      const path = kind === 'missing configuration' ? undefined : kind === 'nonexistent directory' ? absent
        : kind === 'regular file' ? join(directory, 'not-a-directory')
          : kind === 'inaccessible directory' ? denied : relative(process.cwd(), readOnly);
      const app = await launchApplication(dependencyUrl('REDIS_URL'), { NAS_FILES_DIR: path });
      try {
        const code = await within(app.exited, 10000, 'Production started or waited instead of rejecting invalid NAS configuration');
        assert.notEqual(code, 0, app.output);
        assert.doesNotMatch(app.output, /Portal-BSC listening on/);
        await assert.rejects(stat(absent), (error: any) => error.code === 'ENOENT');
      } finally { await app.close(); }
    });
  }

  it('accepts readable/searchable existing NAS directories without requiring write permission', async () => {
    await assert.rejects(writeFile(join(readOnly, 'must-not-write'), 'fixture'));
    const app = await launchApplication(dependencyUrl('REDIS_URL'), { NAS_FILES_DIR: readOnly });
    try {
      await within(app.ready, 10000, 'Read-only NAS directory was rejected');
      assert.equal((await browser(app.url).request('/login')).status, 200);
    } finally { await app.close(); }
  });

  it('preserves development creation of a configured temporary files directory', async () => {
    const path = join(directory, 'development');
    const app = await launchApplication(dependencyUrl('REDIS_URL'), { NODE_ENV: 'development', NAS_FILES_DIR: path });
    try {
      await within(app.ready, 10000, 'Development directory was not initialized');
      assert.equal((await stat(path)).isDirectory(), true);
    } finally { await app.close(); }
  });
});
