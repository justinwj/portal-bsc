import * as dotenv from 'dotenv';
import { UsersService } from './users/users.service';
import { CouchDbService } from './common/couchdb.service';
import { couchDbConnection } from './config/couchdb.configuration';

dotenv.config();

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!username?.trim() || !email?.trim() || !password?.trim()) {
    throw new Error('Admin bootstrap requires ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD');
  }

  couchDbConnection(process.env, true);
  const couchDb = new CouchDbService();
  await couchDb.initialize({ allowMemoryFallback: false });
  const usersService = new UsersService(couchDb);
  const result = await usersService.seedAdmin(username, email, password);

  if (result.message === 'admin-created') {
    console.log(`Admin user created: ${result.username}`);
    return;
  }

  if (result.message === 'admin-already-present') {
    console.log(`Admin user already present: ${result.username}`);
    return;
  }

  throw new Error('Administrator bootstrap did not return a verified success result');
}

seedAdmin().catch((error) => {
  console.error('Failed to seed admin:', error instanceof Error ? error.message : 'Unknown bootstrap failure');
  process.exit(1);
});
