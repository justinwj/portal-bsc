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
  findFileById: async (id: string) => ({
    _id: '1', type: 'file', title: 'staff-only', description: '', storedFilename: 'a.pdf', originalFilename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', category: 'docs', visibility: 'private', allowedRoles: [UserRole.ADMIN], uploadedByUserId: 'u', createdAt: '', updatedAt: '' } ),
  findUserByUsername: async () => null,
  findUserById: async () => null,
};

const filesService = new FilesService(fakeDb as any);
const authService = new AuthService({ findByUsername: async () => ({
  _id: 'u1', username: 'alice', email: 'a@test.com', passwordHash: 'hash', role: UserRole.MEMBER, isActive: true,
}) } as any);

const userService = new UsersService(fakeDb as any);

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

test('user service seed admin should promote existing non-admin', async () => {
  const svc = new UsersService({
    findUserByUsername: async () => ({ _id: 'x', username: 'q', email: 'x', passwordHash: 'hash', role: UserRole.MEMBER, isActive: true }),
    findUserById: async () => ({ _id: 'x', username: 'q', email: 'x', passwordHash: 'hash', role: UserRole.MEMBER, isActive: true }),
    saveUser: async (user: any) => ({ ...user, role: UserRole.ADMIN }),
    createUser: async () => ({ _id: 'n', username: 'x', email: 'x', passwordHash: 'hash', role: UserRole.ADMIN, isActive: true }),
  } as any);
  const res = await svc.seedAdmin('q', 'x', 'secret');
  assert.equal(res.message, 'admin-promoted');
});
