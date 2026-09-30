import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

type Environment = 'development' | 'test' | 'production';
type CookieSecure = 'auto' | 'true' | 'false';
type CookieSameSite = 'lax' | 'strict' | 'none';

class EnvironmentVariables {
  @IsEnum(['development', 'test', 'production'])
  NODE_ENV: Environment = 'development';

  @IsString()
  @IsNotEmpty()
  APP_HOST = '0.0.0.0';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT = 3000;

  @IsString()
  @IsNotEmpty()
  SESSION_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  SESSION_NAME = 'portal.sid';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(300)
  @Max(60 * 60 * 24 * 30)
  SESSION_TTL_SECONDS = 86400;

  @Transform(({ value }) => value === 'true')
  SESSION_REDIS_ENABLED = false;

  @IsString()
  @IsOptional()
  SESSION_REDIS_URL?: string;

  @IsString()
  @IsNotEmpty()
  SESSION_REDIS_PREFIX = 'portal:sess:';

  @IsEnum(['auto', 'true', 'false'])
  COOKIE_SECURE: CookieSecure = 'auto';

  @IsEnum(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE: CookieSameSite = 'lax';

  @IsString()
  @IsOptional()
  COOKIE_DOMAIN?: string;

  @IsEmail()
  ADMIN_EMAIL!: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_NAME = 'Portal Administrator';

  @IsString()
  @IsNotEmpty()
  ADMIN_SEED_OUTPUT_FILE = 'data/bootstrap-admin.json';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(', ')
          : 'invalid value';
        return `${error.property}: ${constraints}`;
      })
      .join('; ');

    throw new Error(`Environment validation failed: ${details}`);
  }

  if (validatedConfig.SESSION_REDIS_ENABLED && !validatedConfig.SESSION_REDIS_URL) {
    throw new Error('Environment validation failed: SESSION_REDIS_URL is required when SESSION_REDIS_ENABLED=true');
  }

  return validatedConfig;
}
