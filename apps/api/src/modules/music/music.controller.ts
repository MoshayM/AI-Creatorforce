import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MusicService } from './music.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('music')
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private readonly music: MusicService) {}

  @Post('brief')
  async brief(@Body() body: { script: unknown; projectId: string; mood?: string; genre?: string }) {
    return this.music.generateBrief(body.script as never, body.projectId, body.mood, body.genre);
  }
}
