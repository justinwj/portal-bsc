import * as dotenv from 'dotenv';
import { UsersService } from './users/users.service';
import { CouchDbService } from './common/couchdb.service';
import { UserRole } from './common/roles';

dotenv.config();

async function seedAdmin() {
  const couchDbService = new CouchDbService();
  const usersService = new UsersService(couchDbService);

  const adminUser = await usersService.seedAdmin(
    process.env.ADMIN_USERNAME || 'admin',
    process.env.ADMIN_EMAIL || 'admin@example.com',
    process.env.ADMIN_PASSWORD || 'ChangeMe123!',
  );

  if (adminUser.role !== UserRole.ADMIN) {
    await usersService.setUserActive(adminUser._id, true);
  }

  console.log('Seeded admin user:', adminUser.username);
}

seedAdmin().catch((error) => {
  console.error('Failed to seed admin:', error);
  process.exit(1);
});
