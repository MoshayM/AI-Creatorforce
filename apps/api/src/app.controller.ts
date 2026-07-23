import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Public()
@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  @Get()
  root() {
    return {
      name: 'AI CreatorForce API',
      version: 'v1',
      status: 'ok',
      endpoints: {
        health: '/health',
        ready: '/ready',
        docs: '/api/v1',
      },
    };
  }
}
