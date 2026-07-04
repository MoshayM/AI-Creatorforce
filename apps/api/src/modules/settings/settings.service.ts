import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const MANAGED_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'YOUTUBE_API_KEY',
  'ELEVENLABS_API_KEY',
] as const;

type ManagedKey = (typeof MANAGED_KEYS)[number];

export interface ApiKeyEntry {
  key: ManagedKey;
  label: string;
  masked: string;
  set: boolean;
}

const LABELS: Record<ManagedKey, string> = {
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  OPENAI_API_KEY: 'OpenAI API Key',
  GEMINI_API_KEY: 'Gemini API Key',
  YOUTUBE_API_KEY: 'YouTube Data API Key',
  ELEVENLABS_API_KEY: 'ElevenLabs API Key (real voice narration)',
};

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return '••••••••' + value.slice(-4);
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  // On startup, load DB values into process.env so agents pick them up
  async onModuleInit() {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: [...MANAGED_KEYS] } },
    });
    for (const row of rows) {
      if (row.value) process.env[row.key] = row.value;
    }
  }

  async getApiKeys(): Promise<ApiKeyEntry[]> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: [...MANAGED_KEYS] } },
    });
    const dbMap = new Map(rows.map((r) => [r.key, r.value]));

    return MANAGED_KEYS.map((key) => {
      const value = dbMap.get(key) ?? process.env[key] ?? '';
      return {
        key,
        label: LABELS[key],
        masked: mask(value),
        set: !!value,
      };
    });
  }

  async updateApiKeys(updates: Partial<Record<ManagedKey, string>>) {
    for (const [key, value] of Object.entries(updates)) {
      if (!MANAGED_KEYS.includes(key as ManagedKey)) continue;
      if (!value?.trim()) continue;
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: value.trim() },
        update: { value: value.trim() },
      });
      process.env[key] = value.trim();
    }
  }
}
