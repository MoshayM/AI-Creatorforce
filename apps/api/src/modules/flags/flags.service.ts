import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// Feature flags (docs4/29 progressive delivery, local-first slice): flags live
// in SystemConfig under a `flag:` prefix and gate risky code paths at runtime
// without a deploy. Precedence: FEATURE_FLAGS env JSON (ops kill-switch) >
// DB row > caller default.

const FLAG_PREFIX = 'flag:';
const CACHE_TTL_MS = 30_000;

/** Flag keys are kebab-case identifiers — rejects prefix smuggling and junk. */
export function isValidFlagKey(key: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(key);
}

/**
 * Pure resolution: env override wins, then the DB value, then the default.
 * envJson is the raw FEATURE_FLAGS env string (unparsed — tolerates garbage).
 */
export function resolveFlag(
  key: string,
  envJson: string | undefined,
  dbValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (envJson) {
    try {
      const overrides = JSON.parse(envJson) as Record<string, unknown>;
      if (typeof overrides[key] === 'boolean') return overrides[key];
    } catch {
      // malformed env JSON → ignore, fall through to DB/default
    }
  }
  if (dbValue !== undefined) return dbValue === 'true';
  return defaultValue;
}

@Injectable()
export class FlagsService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: Map<string, string> | null = null;
  private cacheLoadedAt = 0;

  private async dbFlags(): Promise<Map<string, string>> {
    if (this.cache && Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return this.cache;
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: FLAG_PREFIX } },
    });
    this.cache = new Map(rows.map((r) => [r.key.slice(FLAG_PREFIX.length), r.value]));
    this.cacheLoadedAt = Date.now();
    return this.cache;
  }

  async isEnabled(key: string, defaultValue = false): Promise<boolean> {
    const db = await this.dbFlags();
    return resolveFlag(key, process.env['FEATURE_FLAGS'], db.get(key), defaultValue);
  }

  /** All known flags with their resolved state and where the value came from. */
  async list(): Promise<Array<{ key: string; enabled: boolean; source: 'env' | 'db' }>> {
    const db = await this.dbFlags();
    const envKeys = new Set<string>();
    const envJson = process.env['FEATURE_FLAGS'];
    if (envJson) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(envJson) as Record<string, unknown>)) {
          if (typeof v === 'boolean') envKeys.add(k);
        }
      } catch {
        // malformed env JSON → no env-defined flags
      }
    }
    const keys = new Set([...db.keys(), ...envKeys]);
    return [...keys].sort().map((key) => ({
      key,
      enabled: resolveFlag(key, envJson, db.get(key), false),
      source: envKeys.has(key) ? 'env' : 'db',
    }));
  }

  async set(key: string, enabled: boolean): Promise<void> {
    if (!isValidFlagKey(key)) throw new BadRequestException('Invalid flag key');
    await this.prisma.systemConfig.upsert({
      where: { key: `${FLAG_PREFIX}${key}` },
      create: { key: `${FLAG_PREFIX}${key}`, value: String(enabled) },
      update: { value: String(enabled) },
    });
    this.cache = null; // next read refetches
  }
}
