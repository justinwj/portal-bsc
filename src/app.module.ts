import { MiddlewareConsumer, Module, NestModule, OnModuleDestroy, RequestMethod } from '@nestjs/common';
import { rateLimit, MemoryStore } from 'express-rate-limit';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/configuration.module';
import { AppController } from './app.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CouchDbService } from './common/couchdb.service';
import { RolesGuard } from './common/guards/roles.guard';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { HealthController } from './health/health.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { LifecycleController } from './users/lifecycle.controller';
import { QuotaController } from './users/quota.controller';
import { ManagedStorage } from './files/managed-storage.service';
import { UploadsController } from './files/uploads.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [AppController, AuthController, FilesController, HealthController, UsersController, LifecycleController, QuotaController, UploadsController],
  providers: [
    CouchDbService,
    FilesService,
    ManagedStorage,
    UsersService,
    AuthService,
    AuditService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule, OnModuleDestroy {
  private readonly registrationStore = new MemoryStore();
  private readonly registrationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5,
    standardHeaders: 'draft-8', legacyHeaders: false, store: this.registrationStore,
    message: 'Too many registration attempts. Please try again later.' });
  configure(consumer: MiddlewareConsumer) {
    // Runs after main.ts's session, parsing and CSRF middleware. Existing global
    // request limiting remains in place; this is a narrower public abuse limit.
    consumer.apply(this.registrationLimiter).forRoutes({ path: 'register', method: RequestMethod.POST });
  }
  onModuleDestroy() { this.registrationStore.shutdown(); }
}
