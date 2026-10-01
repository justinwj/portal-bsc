import * as dotenv from 'dotenv';
import { UsersService } from './users/users.service';
import { CouchDbService } from './common/couchdb.service';

dotenv.config();

async function seedAdmin() {
  const usersService = new UsersService(new CouchDbService());
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'change-me-to-a-strong-password';

  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
    throw new Error('Production admin bootstrap requires ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD');
  }

  const result = await usersService.seedAdmin(username, email, password);

  if (result.message === 'admin-created') {
    console.log(`Admin user created: ${result.username}`);
    return;
  }

  if (result.message === 'admin-promoted') {
    console.log(`Existing user promoted to admin: ${result.username}`);
    return;
  }

  if (result.message === 'admin-already-present') {
    console.log(`Admin user already present: ${result.username}`);
    return;
  }

  console.log(`Seed result: ${result.message}`);
}

seedAdmin().catch((error) => {
  console.error('Failed to seed admin:', error);
  process.exit(1);
});
