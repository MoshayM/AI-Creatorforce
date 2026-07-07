import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { runFfmpeg, escapeFilterPath } from '../media/adapters/ffmpeg.util';

const CARD_SIZE = 1080;
const WRAP_AT = 26;
const MAX_LINES = 8;

function findFont(): string | null {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Greedy word-wrap for drawtext textfiles (drawtext has no auto-wrap).
 * Overlong single words are hard-split. Pure — exported for tests.
 */
export function wrapQuote(text: string, width = WRAP_AT, maxLines = MAX_LINES): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const chunks = word.length > width ? (word.match(new RegExp(`.{1,${width}}`, 'g')) ?? []) : [word];
    for (const chunk of chunks) {
      if (current.length === 0) current = chunk;
      else if (current.length + 1 + chunk.length <= width) current += ` ${chunk}`;
      else {
        lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, width - 1)}…`;
    return kept;
  }
  return lines;
}

/**
 * Quote-card image factory (Ai-video edit.md §10 "Quote Cards"): renders a
 * stored QUOTE_CARD social-content row to a 1080×1080 PNG — dark card,
 * oversized quotation mark, wrapped quote, attribution + video title.
 * Idempotent: the rendered asset version is remembered on the content row.
 */
@Injectable()
export class QuoteCardRenderService {
  private readonly logger = new Logger(QuoteCardRenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async render(socialContentId: string, userId: string) {
    const piece = await this.prisma.socialContent.findFirst({
      where: { id: socialContentId, kind: 'QUOTE_CARD', importedVideo: { project: { userId } } },
      include: { importedVideo: { select: { projectId: true, title: true } } },
    });
    if (!piece) throw new NotFoundException('Quote card not found');

    const content = piece.content as { quote?: string; attribution?: string | null; renderedVersionId?: string };
    if (content.renderedVersionId) {
      const existing = await this.prisma.assetVersion.findUnique({ where: { id: content.renderedVersionId } });
      if (existing) return { versionId: existing.id, reused: true };
    }
    const quote = (content.quote ?? '').trim();
    if (!quote) throw new NotFoundException('Quote card has no quote text');

    const font = findFont();
    if (!font) throw new NotFoundException('No usable font found on this system for rendering');

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-quote-'));
    try {
      const lines = wrapQuote(quote);
      const quoteFile = path.join(tmpDir, 'quote.txt');
      await fsp.writeFile(quoteFile, lines.join('\n'), 'utf8');
      const creditFile = path.join(tmpDir, 'credit.txt');
      const credit = [content.attribution, piece.importedVideo.title.slice(0, 48)].filter(Boolean).join(' — ');
      await fsp.writeFile(creditFile, credit || ' ', 'utf8');

      // Fewer lines → larger type; clamp so 8 lines still fit above the credit
      const fontSize = Math.max(40, Math.min(72, Math.round(560 / Math.max(3, lines.length))));
      const fontPath = escapeFilterPath(font);
      const filters = [
        `drawtext=fontfile='${fontPath}':text='“':fontcolor=0x8b5cf6:fontsize=220:x=64:y=28`,
        `drawtext=fontfile='${fontPath}':textfile='${escapeFilterPath(quoteFile)}':fontcolor=white:fontsize=${fontSize}:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2`,
        `drawtext=fontfile='${fontPath}':textfile='${escapeFilterPath(creditFile)}':fontcolor=0x9ca3af:fontsize=34:x=(w-text_w)/2:y=h-110`,
      ].join(',');

      const outPath = path.join(tmpDir, 'card.png');
      await runFfmpeg([
        '-f', 'lavfi', '-i', `color=c=0x111827:s=${CARD_SIZE}x${CARD_SIZE}`,
        '-vf', filters,
        '-frames:v', '1',
        outPath,
      ], 120_000);

      const buffer = await fsp.readFile(outPath);
      const asset = await this.prisma.asset.create({
        data: {
          projectId: piece.importedVideo.projectId,
          kind: 'IMAGE',
          label: `Quote card: ${piece.title.slice(0, 60)}`,
          status: 'READY',
        },
      });
      const key = `quote-cards/${piece.importedVideo.projectId}/${asset.id}.png`;
      await this.storage.put(key, buffer);
      const version = await this.prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          r2Key: key,
          provider: 'ffmpeg',
          sizeBytes: BigInt(buffer.length),
          params: { socialContentId, lines: lines.length, fontSize } as never,
        },
      });
      await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
      await this.prisma.socialContent.update({
        where: { id: piece.id },
        data: { content: ({ ...content, renderedVersionId: version.id }) as never },
      });
      this.logger.log(`[quote-card] rendered ${piece.id} → version ${version.id}`);
      return { versionId: version.id, reused: false };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
