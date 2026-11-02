import test from 'node:test';
import assert from 'node:assert/strict';
import { FilesService } from './files/files.service';
import { AuthService } from './auth/auth.service';
import { UsersService } from './users/users.service';
import { UserRole } from './common/roles';

const fakeDb = {
  listFiles: async () => [
    { _id: '1', type: 'file', title: 'staff-only', description: '', storedFilename: 'a.pdf', originalFilename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', category: 'docs', visibility: 'private', allowedRoles: [UserRole.ADMIN], uploadedByUserId: 'u', createdAt: '', updatedAt: '' },
    { _id: '2', type: 'file', title: 'public-doc', description: '', storedFilename: 'b.pdf', originalFilename: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', category: 'docs', visibility: 'public', allowedRoles: [], uploadedByUserId: 'u', createdAt: '', updatedAt: '' },
    { _id: '3', type: 'file', title: 'member-only', description: '', storedFilename: 'c.pdf', originalFilename: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', category: 'docs', visibility: 'private', allowedRoles: [], uploadedByUserId: 'u', createdAt: '', updatedAt: '' },
  ],
  findFileById: async (id: string) => (await fakeDb.listFiles()).find((file) => file._id === id) ?? null,
};

const filesService = new FilesService(fakeDb as any);

test('file lookup fixture returns the requested ID and null for a missing ID', async () => {
  for (const id of ['1', '2', '3']) assert.equal((await fakeDb.findFileById(id))?._id, id);
  assert.equal(await fakeDb.findFileById('missing'), null);
});

test('administrators cannot retrieve private files with empty allowedRoles', async () => {
  await assert.rejects(filesService.getFileForDownload('3', { id: 'admin', username: 'admin', email: 'admin@example.test', role: UserRole.ADMIN }), /not available/i);
});

test('members cannot retrieve an administrator-only file using its valid ID', async () => {
  await assert.rejects(filesService.getFileForDownload('1', { id: 'member', username: 'member', email: 'member@example.test', role: UserRole.MEMBER }), /not available/i);
});

test('nonexistent file IDs are not found even for administrators', async () => {
  await assert.rejects(filesService.getFileForDownload('missing', { id: 'admin', username: 'admin', email: 'admin@example.test', role: UserRole.ADMIN }), /File not found/);
});

for (const role of [UserRole.ADMIN, UserRole.MEMBER]) {
  test(`file listings apply the same role policy as downloads for ${role}`, async () => {
    const user = { id: role, username: role, email: `${role}@example.test`, role };
    const listed = await filesService.listFilesForUser(user);
    assert.deepEqual(listed.map((file) => file._id).sort(), role === UserRole.ADMIN ? ['1', '2'] : ['2']);
    for (const file of listed) assert.equal((await filesService.getFileForDownload(file._id, user))._id, file._id);
  });

  test(`public file IDs remain accessible to authenticated ${role} users`, async () => {
    const file = await filesService.getFileForDownload('2', { id: role, username: role, email: `${role}@example.test`, role });
    assert.equal(file._id, '2');
    assert.equal(file.visibility, 'public');
  });
}

test('private files deny access when allowedRoles is empty', async () => {
  await assert.rejects(() => filesService.getFileForDownload('3', { id: 'u1', username: 'alice', email: 'a@test.com', role: UserRole.MEMBER }), /not available/i);
});

test('private files allow access only for allowed role', async () => {
  const allowed = await filesService.getFileForDownload('1', { id: 'u1', username: 'alice', email: 'a@test.com', role: UserRole.ADMIN });
  assert.equal(allowed.title, 'staff-only');
});

test('auth rejects inactive users', async () => {
  const inactiveAuth = new AuthService({
    findByUsername: async () => ({
      _id: 'u1', username: 'alice', email: 'a@test.com', passwordHash: '$2b$10$4gR9tF2J9C3JX30r3d2F5uP4/7fE2R0Z4mGx8q8cH8k7cP3P2FfO', role: UserRole.MEMBER, isActive: false,
    }),
  } as any);
  const result = await inactiveAuth.validateUser({ username: 'alice', password: 'secret' });
  assert.equal(result, null);
});

test('user service seed admin rejects non-admin collisions without modifying the account', async () => {
  const existing = { _id: 'x', username: 'q', email: 'q@example.test', passwordHash: 'original-hash', role: UserRole.MEMBER, isActive: true };
  const before = { ...existing };
  let writes = 0;
  const svc = new UsersService({
    findUserByUsername: async () => ({ ...existing }),
    findUserById: async () => ({ ...existing }),
    saveUser: async (user: any) => { writes++; return user; },
    createUser: async () => { writes++; throw new Error('Unexpected user creation'); },
  } as any);
  await assert.rejects(svc.seedAdmin('q', 'different@example.test', 'DifferentPassword123'), /non-administrator|not an administrator|collision/i);
  assert.equal(writes, 0);
  assert.deepEqual(existing, before);
});

test('csrf middleware rejects requests without a token', async () => {
  const next = (err?: unknown) => err;
  const req: any = { method: 'POST', session: { csrfToken: 'expected' }, body: {} };
  const res: any = {};
  const result = await new Promise((resolve) => {
    const middleware = require('./common/csrf').csrfMiddleware;
    middleware(req, res, (err?: unknown) => resolve(err));
  });
  assert.ok(result instanceof Error);
});
