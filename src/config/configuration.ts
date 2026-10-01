export default () => {
  const env = {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    sessionSecret: process.env.SESSION_SECRET ?? (process.env.NODE_ENV === 'production' ? undefined : 'development-session-secret'),
    redisUrl: process.env.REDIS_URL ?? (process.env.NODE_ENV === 'production' ? undefined : 'redis://localhost:6379'),
    couchDbUrl: process.env.COUCHDB_URL ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5984'),
    nasFilesDir: process.env.NAS_FILES_DIR ?? (process.env.NODE_ENV === 'production' ? undefined : './data/files'),
    adminUsername: process.env.ADMIN_USERNAME ?? (process.env.NODE_ENV === 'production' ? undefined : 'admin'),
    adminEmail: process.env.ADMIN_EMAIL ?? (process.env.NODE_ENV === 'production' ? undefined : 'admin@example.com'),
    adminPassword: process.env.ADMIN_PASSWORD ?? (process.env.NODE_ENV === 'production' ? undefined : 'change-me-to-a-strong-password'),
    defaultUserRole: process.env.DEFAULT_USER_ROLE ?? 'member',
  };

  return env;
};
