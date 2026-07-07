import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CopilotCommandSchema, EXPENSIVE_ACTIONS } from '@cf/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CopilotService } from './copilot.service';

const IntentRequestSchema = z.object({
  command: CopilotCommandSchema,
  /** Must be true to execute a confirmation-gated command — same gate as chat/voice. */
  confirmed: z.boolean().default(false),
});

/**
 * Unified intent entry point (Ai-video edit.md §8/§15): UI buttons can execute
 * the exact same validated commands as Copilot chat and voice, through the
 * same executor, gates, and audit trail — one execution path for all three
 * modalities.
 */
@Controller('intents')
@UseGuards(JwtAuthGuard)
export class IntentsController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async submit(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const parsed = IntentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid intent');
    }
    const { command, confirmed } = parsed.data;

    // The confirmation gate applies to every modality (§7.4) — UI included.
    if (EXPENSIVE_ACTIONS.includes(command.action) && !confirmed) {
      return {
        intentId: null,
        status: 'needs_confirmation' as const,
        fromCache: false,
        tokensUsed: 0,
        payload: command,
      };
    }

    const result = await this.copilot.executeRecorded(user.sub, command, {
      source: 'UI',
      fromCache: false,
      tokensUsed: 0,
      lastUserText: '',
    });
    return {
      intentId: result.actionId,
      status: 'executed' as const,
      fromCache: false,
      tokensUsed: 0,
      payload: { summary: result.summary, data: result.data },
    };
  }

  @Get(':id')
  async status(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const action = await this.prisma.actionRecord.findFirst({ where: { id, userId: user.sub } });
    if (!action) throw new NotFoundException('Intent not found');
    return action;
  }
}
