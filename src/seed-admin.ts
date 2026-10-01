import * as dotenv from 'dotenv';
import { UsersService } from './users/users.service';
import { CouchDbService } from './common/couchdb.service';

dotenv.config();

async function seedAdmin() {
  const usersService = new UsersService(new CouchDbService());
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const result = await usersService.seedAdmin(username, email, password);

  if (result.message === 'admin-created' || result.message === 'admin-promoted') {
    console.log(`Admin user ready: ${result.username}`);
    return;
  }

  console.log(`Admin user already present: ${result.username}`);
}

seedAdmin().catch((error) => {
  console.error('Failed to seed admin:', error);
  process.exit(1);
});
