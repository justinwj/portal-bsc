import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get nodeEnv(): string {
    return this.configService.getOrThrow<string>('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get appHost(): string {
    return this.configService.getOrThrow<string>('APP_HOST');
  }

  get appPort(): number {
    return this.configService.getOrThrow<number>('APP_PORT');
  }

  get sessionSecret(): string {
    return this.configService.getOrThrow<string>('SESSION_SECRET');
  }

  get sessionName(): string {
    return this.configService.getOrThrow<string>('SESSION_NAME');
  }

  get sessionTtlSeconds(): number {
    return this.configService.getOrThrow<number>('SESSION_TTL_SECONDS');
  }

  get sessionRedisEnabled(): boolean {
    return this.configService.getOrThrow<boolean>('SESSION_REDIS_ENABLED');
  }

  get sessionRedisUrl(): string | undefined {
    return this.configService.get<string>('SESSION_REDIS_URL');
  }

  get sessionRedisPrefix(): string {
    return this.configService.getOrThrow<string>('SESSION_REDIS_PREFIX');
  }

  get cookieSecure(): 'auto' | 'true' | 'false' {
    return this.configService.getOrThrow<'auto' | 'true' | 'false'>('COOKIE_SECURE');
  }

  get cookieSameSite(): 'lax' | 'strict' | 'none' {
    return this.configService.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE');
  }

  get cookieDomain(): string | undefined {
    return this.configService.get<string>('COOKIE_DOMAIN') || undefined;
  }

  get adminEmail(): string {
    return this.configService.getOrThrow<string>('ADMIN_EMAIL');
  }

  get adminPassword(): string {
    return this.configService.getOrThrow<string>('ADMIN_PASSWORD');
  }

  get adminName(): string {
    return this.configService.getOrThrow<string>('ADMIN_NAME');
  }

  get adminSeedOutputFile(): string {
    return this.configService.getOrThrow<string>('ADMIN_SEED_OUTPUT_FILE');
  }
}
