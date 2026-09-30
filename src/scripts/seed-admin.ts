import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PasswordHasher } from '../security/password-hasher';

interface SeedAdminPayload {
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin';
  createdAt: string;
}

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function run(): Promise<void> {
  const email = getEnv('ADMIN_EMAIL').toLowerCase();
  const password = getEnv('ADMIN_PASSWORD');
  const name = getEnv('ADMIN_NAME', 'Portal Administrator');
  const outputPath = resolve(
    process.cwd(),
    getEnv('ADMIN_SEED_OUTPUT_FILE', 'data/bootstrap-admin.json'),
  );

  const payload: SeedAdminPayload = {
    email,
    name,
    passwordHash: await PasswordHasher.hash(password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  });

  // eslint-disable-next-line no-console
  console.log(`Admin seed written to ${outputPath}`);
}

run().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
