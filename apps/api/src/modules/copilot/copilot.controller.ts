import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { CopilotChatRequestSchema } from '@cf/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { CopilotService } from './copilot.service';

@Controller('copilot')
@UseGuards(JwtAuthGuard)
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('chat')
  async chat(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const parsed = CopilotChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid copilot request');
    }
    return this.copilot.chat(user.sub, parsed.data);
  }
}
