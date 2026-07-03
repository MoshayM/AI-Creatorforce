import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ImageService } from './image.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('images')
@UseGuards(JwtAuthGuard)
export class ImageController {
  constructor(private readonly image: ImageService) {}

  @Post('briefs')
  async briefs(@Body() body: { script: unknown; projectId: string; brandKit?: Record<string, unknown> }) {
    return this.image.generateBriefs(body.script as never, body.projectId, body.brandKit);
  }
}
