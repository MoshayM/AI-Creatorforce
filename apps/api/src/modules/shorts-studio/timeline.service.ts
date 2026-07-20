import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { TimelineCommand } from '@cf/shared';
import type { Prisma, ShortsTimelineItem } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

interface SourceProps {
  sourceStartMs?: number;
  sourceEndMs?: number;
  [key: string]: unknown;
}

/** Shift a video item's source mapping when its timeline bounds change (speed 1). */
function remapSource(item: ShortsTimelineItem, newStartMs: number, newEndMs: number): SourceProps {
  const props = (item.properties as SourceProps | null) ?? {};
  if (typeof props.sourceStartMs !== 'number') return props;
  return {
    ...props,
    sourceStartMs: props.sourceStartMs + (newStartMs - item.startMs),
    sourceEndMs: props.sourceStartMs + (newStartMs - item.startMs) + (newEndMs - newStartMs),
  };
}

/**
 * Timeline mutation API (ai.md Sections 8, 18.4). Commands are applied
 * transactionally in order; every command is appended to ShortsTimelineEdit
 * with the actor id ('AI_ASSISTANT' for applied AI suggestions) — the audit
 * trail feeding Section 24.5.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimelineForClip(shortClipId: string, userId: string) {
    const clip = await this.prisma.shortClip.findFirst({
      where: { id: shortClipId, project: { userId } },
      include: {
        timeline: {
          include: {
            tracks: {
              orderBy: { orderIndex: 'asc' },
              include: {
                items: {
                  orderBy: { startMs: 'asc' },
                  include: {
                    sourceAsset: {
                      select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, durationMs: true } } },
                    },
                  },
                },
              },
            },
            captions: { orderBy: { startMs: 'asc' } },
          },
        },
        topicSegment: { select: { title: true, importedVideoId: true, highlight: { select: { titleSuggestion: true } } } },
      },
    });
    if (!clip?.timeline) throw new NotFoundException('Clip or timeline not found');
    return clip;
  }

  async assertTimelineOwnership(timelineId: string, userId: string) {
    const timeline = await this.prisma.shortsTimeline.findFirst({
      where: { id: timelineId, shortClip: { project: { userId } } },
      select: { id: true, shortClipId: true },
    });
    if (!timeline) throw new NotFoundException('Timeline not found');
    return timeline;
  }

  async history(timelineId: string, userId: string) {
    await this.assertTimelineOwnership(timelineId, userId);
    return this.prisma.shortsTimelineEdit.findMany({
      where: { timelineId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Apply commands in order; actorId is the user id or 'AI_ASSISTANT'. */
  async applyCommands(timelineId: string, actorId: string, commands: TimelineCommand[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const command of commands) {
        await this.applyOne(tx, timelineId, command);
        await tx.shortsTimelineEdit.create({
          data: { timelineId, actorId, command: command as never },
        });
      }
      // durationMs tracks the furthest item end so the player/render know clip length
      const agg = await tx.shortsTimelineItem.aggregate({
        where: { track: { timelineId } },
        _max: { endMs: true },
      });
      await tx.shortsTimeline.update({
        where: { id: timelineId },
        data: { durationMs: agg._max.endMs ?? 0 },
      });
      const clipStatus = await tx.shortsTimeline.findUnique({
        where: { id: timelineId },
        select: { shortClipId: true, shortClip: { select: { status: true } } },
      });
      if (clipStatus && clipStatus.shortClip.status === 'CANDIDATE') {
        await tx.shortClip.update({ where: { id: clipStatus.shortClipId }, data: { status: 'IN_EDITING' } });
      }
    });
    return this.prisma.shortsTimeline.findUnique({
      where: { id: timelineId },
      include: {
        tracks: {
          orderBy: { orderIndex: 'asc' },
          include: {
            items: {
              orderBy: { startMs: 'asc' },
              include: {
                sourceAsset: {
                  select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, durationMs: true } } },
                },
              },
            },
          },
        },
        captions: { orderBy: { startMs: 'asc' } },
      },
    });
  }

  private async item(tx: Tx, timelineId: string, itemId: string): Promise<ShortsTimelineItem> {
    const item = await tx.shortsTimelineItem.findFirst({
      where: { id: itemId, track: { timelineId } },
    });
    if (!item) throw new BadRequestException(`Timeline item ${itemId} not found on this timeline`);
    return item;
  }

  private async applyOne(tx: Tx, timelineId: string, command: TimelineCommand): Promise<void> {
    switch (command.type) {
      case 'TRIM': {
        const item = await this.item(tx, timelineId, command.itemId);
        if (command.newEndMs <= command.newStartMs) throw new BadRequestException('TRIM: end must be after start');
        await tx.shortsTimelineItem.update({
          where: { id: item.id },
          data: {
            startMs: command.newStartMs,
            endMs: command.newEndMs,
            properties: remapSource(item, command.newStartMs, command.newEndMs) as never,
          },
        });
        return;
      }

      case 'SPLIT': {
        const item = await this.item(tx, timelineId, command.itemId);
        if (command.atMs <= item.startMs || command.atMs >= item.endMs) {
          throw new BadRequestException('SPLIT: point must be inside the item');
        }
        const rightProps = remapSource(item, command.atMs, item.endMs);
        await tx.shortsTimelineItem.update({
          where: { id: item.id },
          data: { endMs: command.atMs, properties: remapSource(item, item.startMs, command.atMs) as never },
        });
        await tx.shortsTimelineItem.create({
          data: {
            trackId: item.trackId,
            startMs: command.atMs,
            endMs: item.endMs,
            sourceAssetId: item.sourceAssetId,
            cropRect: item.cropRect as never,
            rotationDeg: item.rotationDeg,
            speed: item.speed,
            volume: item.volume,
            properties: rightProps as never,
          },
        });
        return;
      }

      case 'DELETE': {
        const item = await this.item(tx, timelineId, command.itemId);
        await tx.shortsTimelineItem.delete({ where: { id: item.id } });
        return;
      }

      case 'MERGE': {
        const [a, b] = await Promise.all([
          this.item(tx, timelineId, command.itemIds[0]),
          this.item(tx, timelineId, command.itemIds[1]),
        ]);
        if (a.trackId !== b.trackId) throw new BadRequestException('MERGE: items must be on the same track');
        const [left, right] = a.startMs <= b.startMs ? [a, b] : [b, a];
        await tx.shortsTimelineItem.update({
          where: { id: left.id },
          data: { endMs: right.endMs, properties: remapSource(left, left.startMs, right.endMs) as never },
        });
        await tx.shortsTimelineItem.delete({ where: { id: right.id } });
        return;
      }

      case 'DUPLICATE': {
        const item = await this.item(tx, timelineId, command.itemId);
        const length = item.endMs - item.startMs;
        await tx.shortsTimelineItem.create({
          data: {
            trackId: item.trackId,
            startMs: item.endMs,
            endMs: item.endMs + length,
            sourceAssetId: item.sourceAssetId,
            cropRect: item.cropRect as never,
            rotationDeg: item.rotationDeg,
            speed: item.speed,
            volume: item.volume,
            properties: item.properties as never,
          },
        });
        return;
      }

      case 'MOVE': {
        const item = await this.item(tx, timelineId, command.itemId);
        const track = await tx.shortsTimelineTrack.findFirst({ where: { id: command.toTrackId, timelineId } });
        if (!track) throw new BadRequestException('MOVE: target track not found on this timeline');
        const length = item.endMs - item.startMs;
        await tx.shortsTimelineItem.update({
          where: { id: item.id },
          data: { trackId: track.id, startMs: command.toStartMs, endMs: command.toStartMs + length },
        });
        return;
      }

      case 'RESIZE': {
        const item = await this.item(tx, timelineId, command.itemId);
        const newStartMs = command.edge === 'start' ? item.startMs + command.deltaMs : item.startMs;
        const newEndMs = command.edge === 'end' ? item.endMs + command.deltaMs : item.endMs;
        if (newEndMs <= newStartMs || newStartMs < 0) throw new BadRequestException('RESIZE: invalid bounds');
        await tx.shortsTimelineItem.update({
          where: { id: item.id },
          data: {
            startMs: newStartMs,
            endMs: newEndMs,
            properties: remapSource(item, newStartMs, newEndMs) as never,
          },
        });
        return;
      }

      case 'CUT_RANGE': {
        // Ripple cut across ALL tracks + captions: remove [startMs, endMs),
        // shift everything after it left — A/V/caption sync is preserved.
        const { startMs, endMs } = command;
        if (endMs <= startMs) throw new BadRequestException('CUT_RANGE: end must be after start');
        const cutLen = endMs - startMs;

        const items = await tx.shortsTimelineItem.findMany({ where: { track: { timelineId } } });
        for (const item of items) {
          if (item.endMs <= startMs) continue; // entirely before — untouched
          if (item.startMs >= endMs) {
            // entirely after — shift left
            await tx.shortsTimelineItem.update({
              where: { id: item.id },
              data: { startMs: item.startMs - cutLen, endMs: item.endMs - cutLen },
            });
          } else if (item.startMs >= startMs && item.endMs <= endMs) {
            // fully inside the cut — remove
            await tx.shortsTimelineItem.delete({ where: { id: item.id } });
          } else if (item.startMs < startMs && item.endMs > endMs) {
            // straddles the whole cut — shrink, keeping the source mapping of both sides contiguous is
            // impossible on one item, so split into left+right and shift right
            const rightProps = remapSource(item, endMs, item.endMs);
            await tx.shortsTimelineItem.update({
              where: { id: item.id },
              data: { endMs: startMs, properties: remapSource(item, item.startMs, startMs) as never },
            });
            await tx.shortsTimelineItem.create({
              data: {
                trackId: item.trackId,
                startMs: startMs,
                endMs: startMs + (item.endMs - endMs),
                sourceAssetId: item.sourceAssetId,
                cropRect: item.cropRect as never,
                rotationDeg: item.rotationDeg,
                speed: item.speed,
                volume: item.volume,
                properties: rightProps as never,
              },
            });
          } else if (item.startMs < startMs) {
            // overlaps cut start — trim tail
            await tx.shortsTimelineItem.update({
              where: { id: item.id },
              data: { endMs: startMs, properties: remapSource(item, item.startMs, startMs) as never },
            });
          } else {
            // overlaps cut end — trim head and shift to close the gap
            const keepLen = item.endMs - endMs;
            const props = remapSource(item, endMs, item.endMs);
            await tx.shortsTimelineItem.update({
              where: { id: item.id },
              data: { startMs, endMs: startMs + keepLen, properties: props as never },
            });
          }
        }

        const captions = await tx.shortsCaption.findMany({ where: { timelineId } });
        for (const cap of captions) {
          if (cap.endMs <= startMs) continue;
          if (cap.startMs >= endMs) {
            await tx.shortsCaption.update({
              where: { id: cap.id },
              data: { startMs: cap.startMs - cutLen, endMs: cap.endMs - cutLen },
            });
          } else if (cap.startMs >= startMs && cap.endMs <= endMs) {
            await tx.shortsCaption.delete({ where: { id: cap.id } });
          } else {
            // partial overlap — clamp to the surviving side
            const newStart = cap.startMs < startMs ? cap.startMs : startMs;
            const newEnd = cap.endMs > endMs ? startMs + (cap.endMs - endMs) : startMs;
            if (newEnd - newStart < 200) {
              await tx.shortsCaption.delete({ where: { id: cap.id } });
            } else {
              await tx.shortsCaption.update({ where: { id: cap.id }, data: { startMs: newStart, endMs: newEnd } });
            }
          }
        }
        return;
      }
    }
  }
}
