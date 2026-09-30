export default () => ({
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  sessionSecret: process.env.SESSION_SECRET ?? 'local-dev-secret',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  couchDbUrl: process.env.COUCHDB_URL ?? 'http://localhost:5984',
  nasFilesDir: process.env.NAS_FILES_DIR ?? './data/files',
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
  defaultUserRole: process.env.DEFAULT_USER_ROLE ?? 'member',
});
