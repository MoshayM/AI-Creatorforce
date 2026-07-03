import { z } from 'zod';

// AI models sometimes return synonymous values for enums.
// Normalize them before validation so schema mismatches don't fail compliant content.

const CATEGORY_ALIASES: Record<string, string> = {
  MISINFORMATION_RISK: 'MISINFORMATION',
  MISINFORMATION_POTENTIAL: 'MISINFORMATION',
  FALSE_INFORMATION: 'MISINFORMATION',
  MISLEADING: 'MISINFORMATION',
  MISLEADING_CONTENT: 'MISINFORMATION',
  HATE: 'HATE_SPEECH',
  OFFENSIVE: 'HATE_SPEECH',
  GRAPHIC_VIOLENCE: 'VIOLENCE',
  GRAPHIC_CONTENT: 'VIOLENCE',
  SEXUAL_CONTENT: 'ADULT_CONTENT',
  ADULT: 'ADULT_CONTENT',
  EXPLICIT_CONTENT: 'ADULT_CONTENT',
  SELF_PROMOTION: 'SPAM',
  CLICKBAIT: 'SPAM',
  ADVERTISER_FRIENDLY_CONTENT: 'ADVERTISER_FRIENDLY',
  BRAND_SAFETY: 'ADVERTISER_FRIENDLY',
  AD_FRIENDLY: 'ADVERTISER_FRIENDLY',
};

const SEVERITY_ALIASES: Record<string, string> = {
  LOW: 'INFO',
  NONE: 'INFO',
  MINOR: 'INFO',
  MEDIUM: 'WARNING',
  MODERATE: 'WARNING',
  HIGH: 'CRITICAL',
  SEVERE: 'BLOCK',
  FATAL: 'BLOCK',
};

function normalizeStr(aliases: Record<string, string>, val: unknown): string {
  const str = typeof val === 'string' ? val : String(val ?? '');
  const upper = str.toUpperCase().replace(/[- ]/g, '_');
  return aliases[upper] ?? upper;
}

export const ComplianceFlagSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL', 'BLOCK']);
export type ComplianceFlagSeverity = z.infer<typeof ComplianceFlagSeveritySchema>;

// Clean schema used for TypeScript type derivation
export const ComplianceFlagSchema = z.object({
  category: z.enum([
    'COPYRIGHT',
    'MISINFORMATION',
    'HATE_SPEECH',
    'VIOLENCE',
    'ADULT_CONTENT',
    'SPAM',
    'IMPERSONATION',
    'PRIVACY',
    'ADVERTISER_FRIENDLY',
  ]),
  severity: ComplianceFlagSeveritySchema,
  description: z.string(),
  excerpt: z.string().optional(),
});
export type ComplianceFlag = z.infer<typeof ComplianceFlagSchema>;

function normalizeFlag(raw: unknown): ComplianceFlag {
  const f = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return ComplianceFlagSchema.parse({
    category: normalizeStr(CATEGORY_ALIASES, f['category']),
    severity: normalizeStr(SEVERITY_ALIASES, f['severity']),
    description: String(f['description'] ?? ''),
    excerpt: f['excerpt'] != null ? String(f['excerpt']) : undefined,
  });
}

export const ComplianceResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  // Accept any array from the AI and normalize each flag's enum values.
  flags: z.array(z.any()).transform((arr: unknown[]) => arr.map(normalizeFlag)),
  reviewerAI: z.string(),
  summary: z.string(),
});
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;

export const COMPLIANCE_PASS_THRESHOLD = 70;

export function isComplianceBlocked(result: ComplianceResult): boolean {
  return result.flags.some((f) => f.severity === 'BLOCK');
}

export function mustPassCompliance(result: ComplianceResult): void {
  if (!result.passed || isComplianceBlocked(result)) {
    throw new Error(
      `Compliance gate BLOCKED. Score: ${result.score}. ` +
      `BLOCK flags: ${result.flags.filter((f) => f.severity === 'BLOCK').map((f) => f.category).join(', ')}`,
    );
  }
}
