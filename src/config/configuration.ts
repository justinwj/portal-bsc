export default () => {
  const isProduction = process.env.NODE_ENV === 'production';

  const env = {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    sessionSecret: isProduction ? process.env.SESSION_SECRET : process.env.SESSION_SECRET ?? 'development-session-secret',
    redisUrl: isProduction ? process.env.REDIS_URL : process.env.REDIS_URL ?? 'redis://localhost:6379',
    couchDbUrl: isProduction ? process.env.COUCHDB_URL : process.env.COUCHDB_URL ?? 'http://localhost:5984',
    nasFilesDir: isProduction ? process.env.NAS_FILES_DIR : process.env.NAS_FILES_DIR ?? './data/files',
    adminUsername: isProduction ? process.env.ADMIN_USERNAME : process.env.ADMIN_USERNAME ?? 'admin',
    adminEmail: isProduction ? process.env.ADMIN_EMAIL : process.env.ADMIN_EMAIL ?? 'admin@example.com',
    adminPassword: isProduction ? process.env.ADMIN_PASSWORD : process.env.ADMIN_PASSWORD ?? 'change-me-to-a-strong-password',
    defaultUserRole: process.env.DEFAULT_USER_ROLE ?? 'member',
  };

  return env;
};
