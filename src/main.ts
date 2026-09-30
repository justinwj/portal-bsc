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

  app.enableCors();
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
  const { RedisStore } = require('connect-redis');
  const redisClient = new Redis(redisUrl);
  let sessionStore: any = undefined;

  redisClient.on('error', () => {
    sessionStore = undefined;
  });

  if (redisClient.status === 'ready') {
    sessionStore = new RedisStore({ client: redisClient, logErrors: true });
  }

  app.use(
    session.default({
      secret: process.env.SESSION_SECRET || 'local-dev-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 1000,
      },
    }),
  );

  app.use(csurf.default({ cookie: false }));
  app.use((req: any, _res: any, next: any) => {
    req.csrfToken = req.csrfToken || (() => '');
    next();
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

  const rootDir = process.env.NAS_FILES_DIR || resolve(process.cwd(), 'data/files');
  if (!existsSync(rootDir)) {
    mkdirSync(rootDir, { recursive: true });
  }

  await app.listen(port, '0.0.0.0');
  console.log(`Portal-BSC listening on http://0.0.0.0:${port}`);
}

bootstrap();
