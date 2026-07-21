import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ImageService } from './image.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TierRateLimit } from '../../common/guards/rate-limit.guard';

@Controller('images')
@UseGuards(JwtAuthGuard)
@TierRateLimit({ bucket: 'image-generate', windowSecs: 3600, limits: { FREE: 5, STARTER: 15, PRO: 50, AGENCY: 120, default: 5 } })
export class ImageController {
  constructor(private readonly image: ImageService) {}

  @Post('briefs')
  async briefs(@Body() body: { script: unknown; projectId: string; brandKit?: Record<string, unknown> }) {
    return this.image.generateBriefs(body.script as never, body.projectId, body.brandKit);
  }
}
