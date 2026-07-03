import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MetadataService } from './metadata.service';
import type { ScriptOutput } from '@cf/shared';

@ApiTags('metadata')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metadata')
export class MetadataController {
  constructor(private readonly svc: MetadataService) {}

  @Post('generate')
  generate(@Body() body: { script: ScriptOutput; channelNiche?: string }) {
    return this.svc.generate(body.script, body.channelNiche);
  }
}
