import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Usado pelo healthcheck do Docker/Railway. Público e sem dados sensíveis. */
  @Get('health')
  @SkipThrottle()
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
