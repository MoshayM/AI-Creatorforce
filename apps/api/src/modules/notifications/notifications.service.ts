import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Stable deduplication key for a notification.
 * Combines type with a sorted JSON representation of the meta object so that
 * the same logical event always produces the same key regardless of property
 * insertion order.
 */
export function dedupeKeyWindow(type: string, meta: Record<string, unknown>): string {
  const sortedKeys = Object.keys(meta).sort();
  const stable = sortedKeys.map((k) => `${k}:${String(meta[k])}`).join('|');
  return `${type}::${stable}`;
}

/**
 * Returns the day-mark (7, 3, or 1) that should fire a trial-expiry
 * notification, or null if none applies.
 *
 * Semantics: we fire exactly once per mark — when the time-to-expiry FIRST
 * drops below that mark's threshold (measured in full calendar days) AND the
 * mark has not yet been recorded in notifiedDays.
 *
 * @param expiresAt  Trial expiry timestamp.
 * @param now        Current time (injectable for deterministic tests).
 * @param notifiedDays  Day-marks already sent for this grant, e.g. [7, 3].
 */
export function shouldNotifyTrialExpiry(
  expiresAt: Date,
  now: Date,
  notifiedDays: number[],
): number | null {
  const msRemaining = expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) return null; // already expired — sweep job handles this

  const daysRemaining = msRemaining / (24 * 60 * 60_000);

  // Evaluate marks from smallest to largest so the most urgent mark wins
  // when multiple thresholds are crossed simultaneously (e.g. first run after
  // days without a check). Ordered list: fire the smallest pending mark.
  const MARKS = [1, 3, 7] as const;
  for (const mark of MARKS) {
    if (daysRemaining <= mark) {
      // The smallest applicable mark is the only truthful one — if it was
      // already sent, never escalate to a larger ("3 days left" at 10 hours
      // remaining) mark.
      return notifiedDays.includes(mark) ? null : mark;
    }
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotificationListResult {
  items: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    meta: unknown;
    readAt: Date | null;
    createdAt: Date;
  }>;
  unreadCount: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/** Dedupe window: suppress identical unread notification within this window. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60_000;
const LIST_DEFAULT_TAKE = 20;
const LIST_MAX_TAKE = 50;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a notification for a user.
   *
   * NEVER throws to callers — a notification failure must never break the
   * business flow that triggered it. Log at warn level and return.
   *
   * DEDUPE: if an unread row with the same userId + type and the same dedupe
   * key exists within the last 24h, the new row is silently skipped.
   *
   * Extension point: email/push integrations can be wired here per type in
   * the future — for now in-app only.
   */
  async notify(
    userId: string,
    type: string,
    title: string,
    body?: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const dedupeKey = dedupeKeyWindow(type, meta);
      const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);

      const existing = await this.prisma.notification.findFirst({
        where: {
          userId,
          type,
          readAt: null,
          createdAt: { gte: windowStart },
        },
        select: { id: true, meta: true },
      });

      if (existing) {
        // Check if same dedupe key
        const existingKey = dedupeKeyWindow(
          type,
          (existing.meta ?? {}) as Record<string, unknown>,
        );
        if (existingKey === dedupeKey) {
          this.logger.debug(`[notifications] deduped ${type} for user ${userId}`);
          return;
        }
      }

      await this.prisma.notification.create({
        data: { userId, type, title, body, meta: meta as Prisma.InputJsonObject },
      });
    } catch (err) {
      this.logger.warn(
        `[notifications] notify failed (non-fatal) for user ${userId} type ${type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * List notifications for a user, newest first.
   *
   * @param unreadOnly  When true, only unread rows are returned.
   * @param take        Max rows to return; clamped to LIST_MAX_TAKE.
   */
  async list(
    userId: string,
    opts: { unreadOnly?: boolean; take?: number } = {},
  ): Promise<NotificationListResult> {
    const take = Math.min(opts.take ?? LIST_DEFAULT_TAKE, LIST_MAX_TAKE);
    const where = {
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          meta: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, unreadCount };
  }

  /** Mark a single notification as read. No-ops if already read or not owned. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Mark all of a user's notifications as read. */
  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
