import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('voice')
@UseGuards(JwtAuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('spec')
  async generateSpec(@Body() body: { script: unknown; projectId: string; voiceProfile?: Record<string, unknown> }) {
    return this.voice.generateSpec(body.script as never, body.projectId, body.voiceProfile);
  }
}
