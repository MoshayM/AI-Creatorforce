import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { NotificationsService, type NotificationListResult } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * GET /notifications?unreadOnly=true&take=20
   * Returns the user's notifications newest-first plus an unread count.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('take') take?: string,
  ): Promise<NotificationListResult> {
    return this.notifications.list(user.sub, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      take: take !== undefined ? parseInt(take, 10) : undefined,
    });
  }

  /**
   * POST /notifications/:id/read → 204
   * Marks a single notification as read. Idempotent.
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markRead(user.sub, id);
  }

  /**
   * POST /notifications/read-all → 204
   * Marks all of the user's notifications as read.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.notifications.markAllRead(user.sub);
  }
}
