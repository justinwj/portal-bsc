import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as session from 'express-session';
import * as helmet from 'helmet';
import * as rateLimit from 'express-rate-limit';
import { engine } from 'express-handlebars';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { createClient } from 'redis';
import { AppModule } from './app.module';
import { attachCsrfToken, csrfMiddleware } from './common/csrf';
import { CouchDbService } from './common/couchdb.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  const isProduction = process.env.NODE_ENV === 'production';
  const sessionSecret = process.env.SESSION_SECRET ?? (isProduction ? undefined : 'development-session-secret');
  const redisUrl = process.env.REDIS_URL ?? (isProduction ? undefined : 'redis://localhost:6379');

  if (isProduction && !sessionSecret) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  if (isProduction && !redisUrl) {
    throw new Error('REDIS_URL must be set in production');
  }

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet.default());
  app.use(
    rateLimit.default({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  const redisClient = createClient({ url: redisUrl, socket: { connectTimeout: 5000 } });
  redisClient.on('error', (error) => {
    console.error('Redis client error:', error);
  });

  const allowMemoryFallback = !isProduction && process.env.ALLOW_IN_MEMORY_SESSION_STORE === 'true';
  if (!allowMemoryFallback) {
    try {
      await redisClient.connect();
    } catch (error) {
      throw new Error(`Redis session store failed to initialize: ${(error as Error).message}`);
    }
  }

  const RedisStore = require('connect-redis').default;
  const sessionStore = allowMemoryFallback ? new session.MemoryStore() : new RedisStore({ client: redisClient, logErrors: true });

  app.use(
    session.default({
      secret: sessionSecret || 'portal-bsc-session-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 60 * 60 * 1000,
      },
      proxy: true,
    }),
  );

  app.use(require('express').urlencoded({ extended: false }));
  app.use((req: any, res: any, next: any) => attachCsrfToken(req, res, next));
  app.use((req: any, res: any, next: any) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      return csrfMiddleware(req, res, next);
    }
    return next();
  });

  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: join(process.cwd(), 'views/layouts'),
    partialsDir: join(process.cwd(), 'views/partials'),
  }));
  app.setViewEngine('hbs');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const couchDbService = app.get(CouchDbService);
  await couchDbService.initialize();

  const rootDir = process.env.NAS_FILES_DIR ?? resolve(process.cwd(), 'data/files');
  if (!existsSync(rootDir)) {
    mkdirSync(rootDir, { recursive: true });
  }

  await app.listen(port, '0.0.0.0');
  console.log(`Portal-BSC listening on http://0.0.0.0:${port}`);
}

bootstrap();
