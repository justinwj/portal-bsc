import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
