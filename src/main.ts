import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as session from 'express-session';
import * as helmet from 'helmet';
import * as csurf from 'csurf';
import * as rateLimit from 'express-rate-limit';
import { engine } from 'express-handlebars';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import Redis from 'ioredis';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  const isProduction = process.env.NODE_ENV === 'production';

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

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  if (isProduction) {
    try {
      await redisClient.connect();
    } catch (error) {
      throw new Error(`Redis session store failed to initialize: ${(error as Error).message}`);
    }
  }

  const { RedisStore } = require('connect-redis');
  const sessionStore = isProduction
    ? new RedisStore({ client: redisClient, logErrors: true })
    : process.env.ALLOW_IN_MEMORY_SESSION_STORE === 'true'
      ? new session.MemoryStore()
      : new RedisStore({ client: redisClient, logErrors: true });

  app.use(
    session.default({
      secret: process.env.SESSION_SECRET || 'dev-session-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 60 * 60 * 1000,
      },
    }),
  );

  app.use(csurf.default({ cookie: false }));

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

  const rootDir = process.env.NAS_FILES_DIR || resolve(process.cwd(), 'data/files');
  if (!existsSync(rootDir)) {
    mkdirSync(rootDir, { recursive: true });
  }

  await app.listen(port, '0.0.0.0');
  console.log(`Portal-BSC listening on http://0.0.0.0:${port}`);
}

bootstrap();
