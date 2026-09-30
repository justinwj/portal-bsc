import { RequestHandler } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { AppConfigService } from '../config/app-config.service';

function resolveSecureCookie(
  mode: 'auto' | 'true' | 'false',
  isProduction: boolean,
): boolean {
  if (mode === 'true') {
    return true;
  }

  if (mode === 'false') {
    return false;
  }

  return isProduction;
}

export async function createSessionMiddleware(
  appConfig: AppConfigService,
): Promise<RequestHandler> {
  const cookieSecure = resolveSecureCookie(
    appConfig.cookieSecure,
    appConfig.isProduction,
  );

  const options: session.SessionOptions = {
    secret: appConfig.sessionSecret,
    name: appConfig.sessionName,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: appConfig.cookieSameSite,
      maxAge: appConfig.sessionTtlSeconds * 1000,
      domain: appConfig.cookieDomain,
    },
  };

  if (appConfig.sessionRedisEnabled) {
    const redisUrl = appConfig.sessionRedisUrl;
    if (!redisUrl) {
      throw new Error('SESSION_REDIS_URL is required when SESSION_REDIS_ENABLED=true');
    }

    const redisClient = createClient({
      url: redisUrl,
    });

    redisClient.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.error('Redis session client error', error);
    });

    await redisClient.connect();
    options.store = new RedisStore({
      client: redisClient,
      prefix: appConfig.sessionRedisPrefix,
    });
  }

  return session(options);
}
