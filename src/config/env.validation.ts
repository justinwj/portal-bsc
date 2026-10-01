import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsEnum(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  SESSION_SECRET: string = 'dev-session-secret';

  @IsString()
  @IsNotEmpty()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsString()
  @IsNotEmpty()
  COUCHDB_URL: string = 'http://localhost:5984';

  @IsString()
  @IsNotEmpty()
  NAS_FILES_DIR: string = './data/files';

  @IsString()
  @IsNotEmpty()
  ADMIN_USERNAME: string = 'admin';

  @IsString()
  @IsNotEmpty()
  ADMIN_EMAIL: string = 'admin@example.com';

  @IsString()
  @IsNotEmpty()
  ADMIN_PASSWORD: string = 'ChangeMe123!';
}

export function validateEnv(config: Record<string, any>) {
  const merged = {
    ...config,
    NODE_ENV: config.NODE_ENV ?? 'development',
    PORT: config.PORT ?? 3000,
    SESSION_SECRET: config.SESSION_SECRET ?? (config.NODE_ENV === 'production' ? undefined : 'dev-session-secret'),
    REDIS_URL: config.REDIS_URL ?? (config.NODE_ENV === 'production' ? undefined : 'redis://localhost:6379'),
    COUCHDB_URL: config.COUCHDB_URL ?? (config.NODE_ENV === 'production' ? undefined : 'http://localhost:5984'),
    NAS_FILES_DIR: config.NAS_FILES_DIR ?? (config.NODE_ENV === 'production' ? undefined : './data/files'),
    ADMIN_USERNAME: config.ADMIN_USERNAME ?? (config.NODE_ENV === 'production' ? undefined : 'admin'),
    ADMIN_EMAIL: config.ADMIN_EMAIL ?? (config.NODE_ENV === 'production' ? undefined : 'admin@example.com'),
    ADMIN_PASSWORD: config.ADMIN_PASSWORD ?? (config.NODE_ENV === 'production' ? undefined : 'ChangeMe123!'),
  };

  const env = plainToInstance(EnvironmentVariables, merged, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => Object.values(err.constraints ?? {}))
      .flat()
      .join(', ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  if (merged.NODE_ENV === 'production') {
    const required = ['SESSION_SECRET', 'REDIS_URL', 'COUCHDB_URL', 'NAS_FILES_DIR', 'ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
    for (const key of required) {
      if (!merged[key] || String(merged[key]).trim() === '') {
        throw new Error(`Production environment requires ${key}`);
      }
    }
  }

  return merged;
}
