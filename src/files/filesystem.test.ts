import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { FileRecord } from '../common/couchdb.service';

describe('NAS filesystem boundary', { concurrency: false }, () => {
  const originalRoot = process.env.NAS_FILES_DIR;
  const service = new FilesService({} as any);
  let root: string;
  const record = (name: unknown) => ({ storedFilename: name } as FileRecord);

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'portal-file-unit-'));
    process.env.NAS_FILES_DIR = root;
    await writeFile(join(root, 'valid.pdf'), 'actual file contents');
    await mkdir(join(root, 'directory'));
  });
  after(async () => {
    if (originalRoot === undefined) delete process.env.NAS_FILES_DIR;
    else process.env.NAS_FILES_DIR = originalRoot;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('streams the contents and size of a real regular file', async () => {
    const result = await service.readFileStream(record('valid.pdf'));
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), 'actual file contents');
    assert.equal(result.size, Buffer.byteLength('actual file contents'));
  });

  it('rejects missing files with a controlled not-found result', async () => {
    await assert.rejects(service.readFileStream(record('absent.pdf')), NotFoundException);
  });

  it('rejects directories before returning a file stream', async () => {
    await assert.rejects(async () => {
      const result = await service.readFileStream(record('directory'));
      // Clean up an unexpected RED success without allowing an unhandled stream error.
      result.stream.on('error', () => undefined);
      result.stream.destroy();
    }, NotFoundException);
  });

  for (const name of ['', '.', '..', '../valid.pdf', '..\\valid.pdf', '/valid.pdf',
    'C:\\valid.pdf', '\\\\host\\valid.pdf', 'nested/valid.pdf', 'valid.pdf\0tail',
    'valid.pdf:alternate-stream', ' valid.pdf', 'valid.pdf ', null, undefined]) {
    it(`rejects unsafe stored filename ${JSON.stringify(name)} instead of rewriting it`, () => {
      assert.throws(() => service.getSecureFilePath(record(name)), NotFoundException);
    });
  }
});
