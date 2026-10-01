import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsEnum(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SESSION_SECRET?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  COUCHDB_URL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  NAS_FILES_DIR?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ADMIN_USERNAME?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ADMIN_PASSWORD?: string;
}

export function validateEnv(config: Record<string, any>) {
  const isProduction = config.NODE_ENV === 'production';
  const merged = {
    ...config,
    NODE_ENV: config.NODE_ENV ?? 'development',
    PORT: config.PORT ?? 3000,
    SESSION_SECRET: isProduction ? config.SESSION_SECRET : config.SESSION_SECRET ?? 'development-session-secret',
    REDIS_URL: isProduction ? config.REDIS_URL : config.REDIS_URL ?? 'redis://localhost:6379',
    COUCHDB_URL: isProduction ? config.COUCHDB_URL : config.COUCHDB_URL ?? 'http://localhost:5984',
    NAS_FILES_DIR: isProduction ? config.NAS_FILES_DIR : config.NAS_FILES_DIR ?? './data/files',
    ADMIN_USERNAME: isProduction ? config.ADMIN_USERNAME : config.ADMIN_USERNAME ?? 'admin',
    ADMIN_EMAIL: isProduction ? config.ADMIN_EMAIL : config.ADMIN_EMAIL ?? 'admin@example.com',
    ADMIN_PASSWORD: isProduction ? config.ADMIN_PASSWORD : config.ADMIN_PASSWORD ?? 'change-me-to-a-strong-password',
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
