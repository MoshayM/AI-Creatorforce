import {
  Controller, Post, Get, Body, UseGuards, BadRequestException,
  UseInterceptors, UploadedFile, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CopilotChatRequestSchema } from '@cf/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { CopilotService } from './copilot.service';
import { SpeechService } from './speech.service';

@Controller('copilot')
@UseGuards(JwtAuthGuard)
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly speech: SpeechService,
  ) {}

  @Post('chat')
  async chat(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const parsed = CopilotChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid copilot request');
    }
    return this.copilot.chat(user.sub, parsed.data);
  }

  /**
   * Server-side speech-to-text. Accepts multipart/form-data with the audio
   * as the "audio" field. Optional "language" field is BCP-47 hint.
   * Provider is controlled by STT_PROVIDER env var (default: whisper).
   */
  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('language') language: string | undefined,
  ) {
    if (!file) throw new BadRequestException('Missing audio file — send as multipart field "audio"');
    return this.speech.transcribe(file.buffer, file.mimetype || 'audio/webm', language);
  }

  /** Whether server-side STT is configured and which provider is active. */
  @Get('stt-status')
  sttStatus() {
    return { available: this.speech.isAvailable, provider: this.speech.provider };
  }

  /** Recent jobs triggered by this user's copilot session (task queue display). */
  @Get('jobs')
  async jobs(@CurrentUser() user: JwtPayload, @Query('take') take?: string) {
    return this.copilot.listRecentJobs(user.sub, take ? parseInt(take, 10) : 10);
  }
}
