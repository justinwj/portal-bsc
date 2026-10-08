import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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

@Module({
  imports: [AppConfigModule],
  controllers: [AppController, AuthController, FilesController, HealthController, UsersController],
  providers: [
    CouchDbService,
    FilesService,
    UsersService,
    AuthService,
    AuditService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Middlewares are setup in main.ts for session and CSRF.
  }
}
