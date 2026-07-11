import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { z } from 'zod';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AICallOptions {
  provider?: AIProvider;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  onProgress?: (event: AIProgressEvent) => void;
  /** Fired after each successful provider call — for per-request token attribution. */
  onUsage?: (event: AIUsageEvent) => void;
  /**
   * Set true to skip the cache adapter for this call (e.g. temperature > 0
   * or intentionally non-deterministic requests).  Default false.
   */
  bypassCache?: boolean;
}

// ── Usage ledger hook (Token Governor — Ai-video edit.md §12.2.8) ─────────────

export interface AIUsageEvent {
  provider: AIProvider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** True when the result was served from the response/embedding cache. */
  fromCache?: boolean;
  /** Discriminates the cache kind for metrics labelling. */
  cacheKind?: 'response' | 'embedding';
}

// ── AI Response Cache Adapter (§6 cache-first) ───────────────────────────────
//
// The shared package must not depend on Redis or Nest.  The API process
// registers a concrete adapter via setAICacheAdapter(); outside the API
// (tests, scripts) the adapter stays null and caching is a no-op.

export interface AICacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

let _cacheAdapter: AICacheAdapter | null = null;

export function setAICacheAdapter(adapter: AICacheAdapter | null): void {
  _cacheAdapter = adapter;
}

/**
 * Stable cache key for AI responses and embeddings.
 * Prefix: `ai:resp:` | `ai:emb:` so Redis namespaces are distinct.
 */
export function aiCacheKey(parts: {
  kind: 'response' | 'embedding';
  model: string;
  system?: string;
  payload: string;
}): string {
  const stable = JSON.stringify({
    kind: parts.kind,
    model: parts.model,
    system: parts.system ?? '',
    payload: parts.payload,
  });
  const hash = createHash('sha256').update(stable).digest('hex');
  const prefix = parts.kind === 'response' ? 'ai:resp:' : 'ai:emb:';
  return prefix + hash;
}

/** Serialised envelope stored in Redis for a cached AI response. */
interface ResponseCacheEnvelope {
  text: string;
  tokensIn: number;
  tokensOut: number;
  provider: AIProvider;
  model: string;
}

let usageListener: ((event: AIUsageEvent) => void) | null = null;

/** Global persistence hook fired after EVERY successful provider call (agents, copilot, workers). */
export function setAIUsageListener(listener: ((event: AIUsageEvent) => void) | null): void {
  usageListener = listener;
}

export interface AICallResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: AIProvider;
  /** True when served from the response cache — lets callers refetch fresh on a stale/bad entry. */
  fromCache?: boolean;
}

export type AIProgressEvent =
  | { type: 'RETRYING'; attempt: number; maxAttempts: number; waitMs: number; provider: AIProvider; statusCode: number; retryAfterMs?: number }
  | { type: 'PROVIDER_SWITCHING'; from: AIProvider; to: AIProvider; reason: string }
  | { type: 'RATE_LIMITED'; provider: AIProvider; waitMs: number; reason: string }
  | { type: 'QUEUED'; estimatedWaitMs: number };

// ── Configuration (all from environment — nothing hardcoded) ──────────────────

function envInt(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function envSet(key: string, fallback: string): Set<number> {
  return new Set((process.env[key] ?? fallback).split(',').map(Number).filter(Number.isFinite));
}

const CFG = {
  concurrency:       () => envInt('AI_CONCURRENCY', 2),
  intervalMs:        () => envInt('AI_REQUEST_INTERVAL_MS', 500),
  maxRetries:        () => envInt('AI_MAX_RETRIES', 5),
  retryBaseMs:       () => envInt('AI_RETRY_BASE_MS', 3000),
  retryMaxMs:        () => envInt('AI_RETRY_MAX_MS', 60000),
  maxInputTokens:    () => envInt('AI_MAX_INPUT_TOKENS', 60000),
  rpmLimit:          () => envInt('AI_RPM_LIMIT', 60),
  tpmLimit:          () => envInt('AI_TPM_LIMIT', 100000),
  dailyReqLimit:     () => envInt('AI_DAILY_REQUEST_LIMIT', 0),    // 0 = unlimited
  monthlyTokenLimit: () => envInt('AI_MONTHLY_TOKEN_LIMIT', 0),    // 0 = unlimited
  cacheTtlMs:        () => envInt('AI_CACHE_TTL_MS', 86400000),    // 24 h
  retryStatuses:     () => envSet('AI_RETRY_STATUSES', '429,408,502,503,504'),
} as const;

// ── Clients ───────────────────────────────────────────────────────────────────

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL    = 'gpt-4o';
const DEFAULT_GEMINI_MODEL    = 'gemini-2.5-flash';
const GEMINI_BASE_URL         = 'https://generativelanguage.googleapis.com/v1beta/openai/';

let _anthropicKey: string | undefined;
let _openaiKey: string | undefined;
let _geminiKey: string | undefined;
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;
let _gemini: OpenAI | null = null;

function getAnthropic(): Anthropic {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  if (!_anthropic || key !== _anthropicKey) { _anthropicKey = key; _anthropic = new Anthropic({ apiKey: key, maxRetries: 0 }); }
  return _anthropic;
}
function getOpenAI(): OpenAI {
  const key = process.env['OPENAI_API_KEY'];
  if (!key) throw new Error('OPENAI_API_KEY not set');
  if (!_openai || key !== _openaiKey) { _openaiKey = key; _openai = new OpenAI({ apiKey: key }); }
  return _openai;
}
function getGemini(): OpenAI {
  const key = process.env['GEMINI_API_KEY'];
  if (!key) throw new Error('GEMINI_API_KEY not set');
  if (!_gemini || key !== _geminiKey) { _geminiKey = key; _gemini = new OpenAI({ apiKey: key, baseURL: GEMINI_BASE_URL }); }
  return _gemini;
}

// ── Provider Health & Scoring ─────────────────────────────────────────────────

interface ProviderHealth {
  score: number;              // 0–100; higher = preferred
  cooldownUntil: number;      // epoch ms
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

const providerHealth = new Map<AIProvider, ProviderHealth>([
  ['anthropic', { score: 100, cooldownUntil: 0, consecutiveFailures: 0, successCount: 0, failureCount: 0 }],
  ['openai',    { score: 80,  cooldownUntil: 0, consecutiveFailures: 0, successCount: 0, failureCount: 0 }],
  ['gemini',    { score: 60,  cooldownUntil: 0, consecutiveFailures: 0, successCount: 0, failureCount: 0 }],
]);

function getHealth(p: AIProvider): ProviderHealth {
  return providerHealth.get(p) ?? { score: 50, cooldownUntil: 0, consecutiveFailures: 0, successCount: 0, failureCount: 0 };
}

function isProviderAvailable(p: AIProvider): boolean {
  return Date.now() > getHealth(p).cooldownUntil;
}

function onProviderSuccess(p: AIProvider): void {
  const h = getHealth(p);
  h.consecutiveFailures = 0;
  h.successCount++;
  h.score = Math.min(100, h.score + 5);
  providerHealth.set(p, h);
}

function onProviderFailure(p: AIProvider, cooldownMs: number): void {
  const h = getHealth(p);
  h.consecutiveFailures++;
  h.failureCount++;
  h.score = Math.max(0, h.score - 20);
  h.cooldownUntil = Date.now() + cooldownMs;
  providerHealth.set(p, h);
  console.warn(`[AI:provider] ${p} cooled for ${Math.round(cooldownMs / 1000)}s (score=${h.score}, failures=${h.consecutiveFailures})`);
}

// Sort providers by health score descending; skip unavailable
function rankProviders(chain: AIProvider[]): AIProvider[] {
  return [...chain].sort((a, b) => getHealth(b).score - getHealth(a).score);
}

/** Live health snapshot for persistence/admin (Phase 5 spec §5) — read-only copy. */
export interface ProviderHealthSnapshot {
  provider: AIProvider;
  score: number;
  available: boolean;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

export function getProviderHealthSnapshot(): ProviderHealthSnapshot[] {
  return [...providerHealth.entries()].map(([provider, h]) => ({
    provider,
    score: h.score,
    available: Date.now() > h.cooldownUntil,
    consecutiveFailures: h.consecutiveFailures,
    successCount: h.successCount,
    failureCount: h.failureCount,
  }));
}

// ── Rate Limiter ──────────────────────────────────────────────────────────────

interface RateLimiterState {
  requestTimestamps: number[];    // sliding window: epoch ms of recent requests
  tokenTimestamps: number[];      // paired with tokenAmounts
  tokenAmounts: number[];
  dailyRequests: number;
  dailyTokens: number;
  monthlyTokens: number;
  lastResetDay: string;
  lastResetMonth: string;
}

const rateLimiterState = new Map<AIProvider, RateLimiterState>();

function getRateLimiter(p: AIProvider): RateLimiterState {
  if (!rateLimiterState.has(p)) {
    rateLimiterState.set(p, {
      requestTimestamps: [], tokenTimestamps: [], tokenAmounts: [],
      dailyRequests: 0, dailyTokens: 0, monthlyTokens: 0,
      lastResetDay: '', lastResetMonth: '',
    });
  }
  return rateLimiterState.get(p)!;
}

function pruneWindow(timestamps: number[], windowMs = 60000): void {
  const cutoff = Date.now() - windowMs;
  while (timestamps.length && timestamps[0]! < cutoff) timestamps.shift();
}

function resetDailyMonthly(state: RateLimiterState): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  if (state.lastResetDay !== day) { state.dailyRequests = 0; state.dailyTokens = 0; state.lastResetDay = day; }
  if (state.lastResetMonth !== month) { state.monthlyTokens = 0; state.lastResetMonth = month; }
}

function checkRateLimit(p: AIProvider, estimatedTokens: number): { allowed: boolean; waitMs: number; reason: string } {
  const state = getRateLimiter(p);
  resetDailyMonthly(state);
  pruneWindow(state.requestTimestamps);
  pruneWindow(state.tokenTimestamps);
  while (state.tokenAmounts.length > state.tokenTimestamps.length) state.tokenAmounts.pop();

  const rpmLimit = CFG.rpmLimit();
  const tpmLimit = CFG.tpmLimit();
  const dailyReqLimit = CFG.dailyReqLimit();
  const monthlyTokLimit = CFG.monthlyTokenLimit();

  // RPM check
  if (rpmLimit > 0 && state.requestTimestamps.length >= rpmLimit) {
    const oldest = state.requestTimestamps[0]!;
    const waitMs = 60000 - (Date.now() - oldest) + 100;
    return { allowed: false, waitMs: Math.max(waitMs, 100), reason: `RPM limit ${rpmLimit} reached` };
  }

  // TPM check
  const windowTokens = state.tokenAmounts.reduce((s, t) => s + t, 0);
  if (tpmLimit > 0 && windowTokens + estimatedTokens > tpmLimit) {
    const oldest = state.tokenTimestamps[0] ?? Date.now();
    const waitMs = 60000 - (Date.now() - oldest) + 100;
    return { allowed: false, waitMs: Math.max(waitMs, 100), reason: `TPM limit ${tpmLimit} reached` };
  }

  // Daily/monthly checks
  if (dailyReqLimit > 0 && state.dailyRequests >= dailyReqLimit) {
    return { allowed: false, waitMs: msUntilMidnight(), reason: `Daily request limit ${dailyReqLimit} reached` };
  }
  if (monthlyTokLimit > 0 && state.monthlyTokens + estimatedTokens > monthlyTokLimit) {
    return { allowed: false, waitMs: msUntilMonthEnd(), reason: `Monthly token limit ${monthlyTokLimit} reached` };
  }

  return { allowed: true, waitMs: 0, reason: '' };
}

function recordRequest(p: AIProvider, tokensUsed: number): void {
  const state = getRateLimiter(p);
  const now = Date.now();
  state.requestTimestamps.push(now);
  state.tokenTimestamps.push(now);
  state.tokenAmounts.push(tokensUsed);
  state.dailyRequests++;
  state.dailyTokens += tokensUsed;
  state.monthlyTokens += tokensUsed;
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function msUntilMonthEnd(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return nextMonth.getTime() - now.getTime();
}

// ── Concurrency Semaphore ─────────────────────────────────────────────────────

class Semaphore {
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private lastReleasedAt = 0;
  constructor(private max: number, private minIntervalMs: number) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const attempt = () => {
        if (this.running < this.max) {
          this.running++;
          resolve(() => {
            const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastReleasedAt));
            setTimeout(() => {
              this.lastReleasedAt = Date.now();
              this.running--;
              if (this.queue.length) this.queue.shift()!();
            }, wait);
          });
        } else {
          this.queue.push(attempt);
        }
      };
      attempt();
    });
  }

  get queueLength(): number { return this.queue.length; }
}

let _semaphore: Semaphore | null = null;
function getSemaphore(): Semaphore {
  if (!_semaphore) _semaphore = new Semaphore(CFG.concurrency(), CFG.intervalMs());
  return _semaphore;
}

// ── Error Classification ──────────────────────────────────────────────────────

function getErrorStatus(err: unknown): number {
  if (!(err instanceof Error)) return 0;
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode
    ?? 0;
  if (status) return status;
  const msg = err.message.toLowerCase();
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return 429;
  if (msg.includes('408') || msg.includes('timeout')) return 408;
  if (msg.includes('502') || msg.includes('bad gateway')) return 502;
  if (msg.includes('503') || msg.includes('service unavailable')) return 503;
  if (msg.includes('504') || msg.includes('gateway timeout')) return 504;
  return 0;
}

function isRetryableError(err: unknown): boolean {
  return CFG.retryStatuses().has(getErrorStatus(err));
}

function retryAfterMs(err: unknown): number {
  const hdrs = (err as { headers?: unknown }).headers;
  if (!hdrs) return 0;
  const val: string | null | undefined =
    typeof (hdrs as { get?: unknown }).get === 'function'
      ? (hdrs as { get: (k: string) => string | null }).get('retry-after')
      : (hdrs as Record<string, string>)['retry-after'];
  if (val) {
    const s = parseFloat(val);
    if (!Number.isNaN(s)) return Math.ceil(s * 1000);
  }
  return 0;
}

function get429Reason(err: unknown): string {
  if (!(err instanceof Error)) return '';
  const body = (err as { body?: Record<string, unknown> }).body;
  if (body?.['error']) return String((body['error'] as Record<string, unknown>)?.['message'] ?? '');
  return err.message.slice(0, 200);
}

// ── Backoff ───────────────────────────────────────────────────────────────────

// Full jitter: random in [0, min(base * 2^attempt, maxMs)]
function fullJitterMs(attempt: number, baseMs: number, maxMs: number): number {
  const cap = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return Math.round(Math.random() * cap);
}

// ── Retry with Progress Callback ──────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  provider: AIProvider,
  opts: { maxRetries?: number; onProgress?: (e: AIProgressEvent) => void } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? CFG.maxRetries();
  const baseMs = CFG.retryBaseMs();
  const maxMs = CFG.retryMaxMs();

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const statusCode = getErrorStatus(err);
      if (!isRetryableError(err) || attempt >= maxRetries) throw err;

      const explicit = retryAfterMs(err);
      const jitter = fullJitterMs(attempt, baseMs, maxMs);
      const waitMs = explicit || jitter;
      const reason = get429Reason(err);

      console.warn(`[AI:retry] ${provider} attempt=${attempt + 1}/${maxRetries} status=${statusCode} wait=${waitMs}ms${reason ? ` reason="${reason}"` : ''}`);

      opts.onProgress?.({
        type: 'RETRYING',
        attempt: attempt + 1,
        maxAttempts: maxRetries,
        waitMs,
        provider,
        statusCode,
        retryAfterMs: explicit || undefined,
      });

      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// ── Token Optimizer ───────────────────────────────────────────────────────────

function optimizePrompt(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

function deduplicateSystemInstructions(system: string): string {
  // Split on sentence boundaries, deduplicate exact sentences
  const lines = system.split('\n').filter(Boolean);
  const seen = new Set<string>();
  return lines.filter((l) => { const k = l.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join('\n');
}

function estimateTokens(text: string): number {
  // ~4 chars per token (conservative estimate for mixed content)
  return Math.ceil(text.length / 4);
}

function buildOptimizedMessages(messages: AIMessage[], systemPrompt: string): { optimized: AIMessage[]; system: string; estimatedTokens: number } {
  const system = deduplicateSystemInstructions(optimizePrompt(systemPrompt));
  const optimized = messages.map((m) => ({ ...m, content: optimizePrompt(m.content) }));
  const totalChars = system.length + optimized.reduce((s, m) => s + m.content.length, 0);
  const estimatedTokens = estimateTokens(totalChars.toString().padStart(totalChars, ' ').slice(0, totalChars));
  return { optimized, system, estimatedTokens: Math.ceil(totalChars / 4) };
}

// ── Cost Estimation ───────────────────────────────────────────────────────────

// Approximate USD per 1M tokens (input / output)
const PROVIDER_COST_PER_1M: Record<AIProvider, { input: number; output: number }> = {
  anthropic: { input: 3.00, output: 15.00 },
  openai:    { input: 2.50, output: 10.00 },
  gemini:    { input: 0.10, output: 0.40  },
};

function estimateCost(provider: AIProvider, tokensIn: number, tokensOut: number): number {
  const rates = PROVIDER_COST_PER_1M[provider];
  return (tokensIn / 1_000_000) * rates.input + (tokensOut / 1_000_000) * rates.output;
}

/** Built-in cost table (USD per 1M tokens) — seed/fallback for DB-configured rates (Phase 5 §4.3). */
export function getDefaultCostRates(): Record<AIProvider, { input: number; output: number }> {
  return { anthropic: { ...PROVIDER_COST_PER_1M.anthropic }, openai: { ...PROVIDER_COST_PER_1M.openai }, gemini: { ...PROVIDER_COST_PER_1M.gemini } };
}

// ── Raw callAI ────────────────────────────────────────────────────────────────

function emitUsage(result: AICallResult, opts: AICallOptions, extra?: { fromCache?: boolean; cacheKind?: 'response' | 'embedding' }): void {
  const event: AIUsageEvent = {
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: extra?.fromCache ? 0 : estimateCost(result.provider, result.tokensIn, result.tokensOut),
    fromCache: extra?.fromCache,
    cacheKind: extra?.cacheKind,
  };
  // Ledger hooks must never break the call they observe
  try { usageListener?.(event); } catch { /* noop */ }
  try { opts.onUsage?.(event); } catch { /* noop */ }
}

export async function callAI(
  messages: AIMessage[],
  opts: AICallOptions = {},
): Promise<AICallResult> {
  // ── Cache-first: check adapter before touching a provider ──────────────────
  const adapter = _cacheAdapter;
  const useCache = adapter !== null && !opts.bypassCache && (opts.temperature === undefined || opts.temperature === 0);

  if (useCache) {
    const payload = JSON.stringify(messages);
    const key = aiCacheKey({ kind: 'response', model: opts.model ?? '', system: opts.systemPrompt, payload });
    try {
      const raw = await adapter.get(key);
      if (raw) {
        const env = JSON.parse(raw) as ResponseCacheEnvelope;
        const cached: AICallResult = { content: env.text, tokensIn: env.tokensIn, tokensOut: env.tokensOut, model: env.model, provider: env.provider, fromCache: true };
        emitUsage(cached, opts, { fromCache: true, cacheKind: 'response' });
        return cached;
      }
    } catch { /* cache get failure is a no-op — fall through to provider */ }
  }

  const result = await callAIProvider(messages, opts);
  emitUsage(result, opts);

  // ── Populate cache on successful provider response ─────────────────────────
  if (useCache && result.content.length > 0) {
    const payload = JSON.stringify(messages);
    const key = aiCacheKey({ kind: 'response', model: opts.model ?? '', system: opts.systemPrompt, payload });
    const ttl = envInt('AI_RESPONSE_CACHE_TTL_SECONDS', 86400);
    const envelope: ResponseCacheEnvelope = { text: result.content, tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model, provider: result.provider };
    try { await adapter!.set(key, JSON.stringify(envelope), ttl); } catch { /* cache write failure is a no-op */ }
  }

  return result;
}

async function callAIProvider(
  messages: AIMessage[],
  opts: AICallOptions = {},
): Promise<AICallResult> {
  const provider = opts.provider ?? 'anthropic';

  if (provider === 'anthropic') {
    const client = getAnthropic();
    const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.systemPrompt,
      messages: anthropicMessages,
    });

    return {
      content: response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join(''),
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      model,
      provider: 'anthropic',
    };
  }

  if (provider === 'openai' || provider === 'gemini') {
    const client = provider === 'gemini' ? getGemini() : getOpenAI();
    const model = opts.model ?? (provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = opts.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))]
      : messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));

    const response = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      messages: openaiMessages,
    });

    const choice = response.choices[0];
    if (!choice) throw new Error(`${provider} returned no choices`);

    return {
      content: choice.message.content ?? '',
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      model,
      provider,
    };
  }

  throw new Error(`Unknown provider: ${String(provider)}`);
}

// ── JSON Utilities ────────────────────────────────────────────────────────────

function repairJson(raw: string): string {
  let s = raw
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  s = s.replace(/,\s*([\]}])/g, '$1');

  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if ((ch === '}' || ch === ']') && stack.length > 0) stack.pop();
    }
  }
  if (inString) s += '"';
  s += stack.reverse().join('');
  return s;
}

function extractJson(text: string): string {
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();

  const fenced = stripped.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced?.[1]) return fenced[1].trim();

  if (stripped.startsWith('{') || stripped.startsWith('[')) return stripped;

  const objStart = stripped.indexOf('{');
  const arrStart = stripped.indexOf('[');
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  if (start === -1) throw new Error('AI response contained no JSON');

  const slice = stripped.slice(start);
  const isObj = stripped[start] === '{';
  const lastClose = isObj ? slice.lastIndexOf('}') : slice.lastIndexOf(']');
  if (lastClose === -1) throw new Error('AI response contained no JSON (no closing bracket)');
  return slice.slice(0, lastClose + 1);
}

function parseJson(raw: string): unknown {
  const jsonStr = extractJson(raw);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return JSON.parse(repairJson(jsonStr));
  }
}

// ── callAIStructured ──────────────────────────────────────────────────────────

export async function callAIStructured<T>(
  messages: AIMessage[],
  // Input type left open so schemas with .default()/.transform() infer T from output
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: AICallOptions = {},
): Promise<T> {
  const t0 = Date.now();
  const onProgress = opts.onProgress;

  const systemWithJson = deduplicateSystemInstructions(
    optimizePrompt(opts.systemPrompt ?? ''),
  ) + '\n\nYou MUST respond ONLY with a single valid JSON object. No markdown code fences, no explanation text, no extra characters before or after the JSON.';

  const { optimized, estimatedTokens } = buildOptimizedMessages(messages, systemWithJson);

  // Reject oversized requests before consuming the semaphore
  const maxInputTok = CFG.maxInputTokens();
  if (maxInputTok > 0 && estimatedTokens > maxInputTok) {
    throw new Error(`Request too large: estimated ${estimatedTokens} input tokens exceeds limit of ${maxInputTok}. Trim the prompt and retry.`);
  }

  // Build provider chain sorted by health score
  const primary: AIProvider = opts.provider ?? 'anthropic';
  const candidates: AIProvider[] = [primary];
  if (primary !== 'openai' && process.env['OPENAI_API_KEY']) candidates.push('openai');
  if (primary !== 'gemini' && process.env['GEMINI_API_KEY']) candidates.push('gemini');
  const chain = rankProviders(candidates);

  let result: AICallResult | null = null;
  let lastErr: unknown = null;
  let retryCount = 0;
  let failoverCount = 0;

  const queueWaitStart = Date.now();
  const release = await getSemaphore().acquire();
  const queueWaitMs = Date.now() - queueWaitStart;

  if (queueWaitMs > 1000) {
    onProgress?.({ type: 'QUEUED', estimatedWaitMs: queueWaitMs });
    console.warn(`[AI:queue] waited ${queueWaitMs}ms in semaphore (queue length was ${getSemaphore().queueLength})`);
  }

  try {
    for (let pi = 0; pi < chain.length; pi++) {
      const provider = chain[pi]!;

      if (!isProviderAvailable(provider)) {
        const h = getHealth(provider);
        const waitSec = Math.round((h.cooldownUntil - Date.now()) / 1000);
        console.warn(`[AI:skip] ${provider} on cooldown for ${waitSec}s more, trying next`);
        continue;
      }

      // Pre-flight rate limit check
      const rl = checkRateLimit(provider, estimatedTokens);
      if (!rl.allowed) {
        onProgress?.({ type: 'RATE_LIMITED', provider, waitMs: rl.waitMs, reason: rl.reason });
        console.warn(`[AI:ratelimit] ${provider} ${rl.reason} — waiting ${rl.waitMs}ms`);
        // If this is the last provider, wait and retry from the beginning
        if (pi === chain.length - 1) {
          await new Promise((r) => setTimeout(r, rl.waitMs));
          pi = -1; // restart chain
          continue;
        }
        // Otherwise skip to next provider
        continue;
      }

      // Notify when failing over to a non-primary provider
      if (pi > 0 || failoverCount > 0) {
        const prevProvider = chain[pi - 1] ?? primary;
        if (prevProvider !== provider) {
          onProgress?.({ type: 'PROVIDER_SWITCHING', from: prevProvider, to: provider, reason: lastErr instanceof Error ? lastErr.message.slice(0, 120) : 'previous provider failed' });
          console.warn(`[AI:failover] switching ${prevProvider} → ${provider}`);
          failoverCount++;
        }
      }

      try {
        const providerOpts = { ...opts, provider, systemPrompt: systemWithJson };
        result = await withRetry(
          () => callAI(optimized, providerOpts),
          provider,
          {
            maxRetries: CFG.maxRetries(),
            onProgress: (e) => {
              retryCount++;
              onProgress?.(e);
            },
          },
        );

        onProviderSuccess(provider);
        recordRequest(provider, result.tokensIn + result.tokensOut);
        break;
      } catch (err: unknown) {
        lastErr = err;
        const statusCode = getErrorStatus(err);
        const cooldownMs = retryAfterMs(err) || 60000;

        if (isRetryableError(err)) {
          onProviderFailure(provider, cooldownMs);
        }
        // Non-retryable errors don't mark the provider as failed (might be a content error)
      }
    }
  } finally {
    release();
  }

  if (!result) {
    const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    throw err;
  }

  const latencyMs = Date.now() - t0;
  const costUsd = estimateCost(result.provider, result.tokensIn, result.tokensOut);

  console.warn(
    `[AI:done] provider=${result.provider} model=${result.model}` +
    ` latency=${latencyMs}ms` +
    ` tokensIn=${result.tokensIn} tokensOut=${result.tokensOut}` +
    ` cost=$${costUsd.toFixed(6)}` +
    ` retries=${retryCount} failovers=${failoverCount}` +
    ` queueWait=${queueWaitMs}ms`,
  );

  // Parse and validate JSON
  let parsed: unknown;
  try {
    parsed = parseJson(result.content);
  } catch {
    // A CACHED response that no longer parses is a stale/poisoned entry — the
    // right recovery is a fresh provider call for the SAME prompt (bypassing
    // the cache), not the fix-message dance against a stale transcript.
    const retryMsgs: AIMessage[] = result.fromCache
      ? messages
      : [
          ...messages,
          { role: 'assistant' as const, content: result.content },
          { role: 'user' as const, content: 'The previous response contained invalid JSON. Return ONLY valid JSON matching the schema. No markdown. No explanation. No code fences.' },
        ];

    let retryResult: AICallResult | null = null;
    const release2 = await getSemaphore().acquire();
    try {
      for (const p of chain) {
        if (!isProviderAvailable(p)) continue;
        try {
          retryResult = await withRetry(() => callAI(retryMsgs, { ...opts, provider: p, systemPrompt: systemWithJson, bypassCache: true }), p);
          onProviderSuccess(p);
          break;
        } catch { /* next provider */ }
      }
    } finally {
      release2();
    }

    if (!retryResult) throw new Error('AI response JSON parse failed and retry produced no response');
    console.warn(`[AI:json-retry] provider=${retryResult.provider} response_len=${retryResult.content.length}`);

    try {
      parsed = parseJson(retryResult.content);
    } catch (finalErr) {
      throw new Error(`AI response JSON parse failed after retry: ${(finalErr as Error).message}`);
    }
  }

  try {
    return schema.parse(parsed);
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e;
    const problems = e.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join(', ');
    // Log what the model actually said — schema failures are undiagnosable without it
    console.warn(`[AI:schema-mismatch] problems="${problems.slice(0, 200)}" raw=${JSON.stringify(parsed).slice(0, 400)}`);

    // Valid JSON but wrong shape — retry once, naming the offending fields
    const fixMsgs: AIMessage[] = [
      ...messages,
      { role: 'assistant' as const, content: JSON.stringify(parsed) },
      { role: 'user' as const, content: `The previous JSON did not match the required schema. Problems: ${problems}. Return the corrected complete JSON object ONLY — include every required field. No markdown, no explanation.` },
    ];
    let fixResult: AICallResult | null = null;
    const release3 = await getSemaphore().acquire();
    try {
      for (const p of chain) {
        if (!isProviderAvailable(p)) continue;
        try {
          fixResult = await withRetry(() => callAI(fixMsgs, { ...opts, provider: p, systemPrompt: systemWithJson, bypassCache: true }), p);
          onProviderSuccess(p);
          break;
        } catch { /* next provider */ }
      }
    } finally {
      release3();
    }
    if (!fixResult) throw new Error(`AI response schema mismatch: ${problems}`);
    console.warn(`[AI:schema-retry] provider=${fixResult.provider} problems="${problems.slice(0, 120)}"`);

    try {
      return schema.parse(parseJson(fixResult.content));
    } catch (e2) {
      const detail = e2 instanceof z.ZodError
        ? e2.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join(', ')
        : (e2 as Error).message;
      throw new Error(`AI response schema mismatch after retry: ${detail}`);
    }
  }
}

// ── Embeddings (Ai-video edit.md §5 Embedding Generation, §12 metering) ───────
// Anthropic has no embeddings API, so the chain is openai → gemini (whichever
// has a key), both through the OpenAI-compatible SDK. Vectors come back
// unit-normalized so a plain dot product IS cosine similarity everywhere.

const EMBEDDING_MODELS: Record<'openai' | 'gemini', string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
};

/** Requested output dims — both models support down-projection to 768. */
export const EMBEDDING_DIMS = 768;

// USD per 1M input tokens (embeddings have no output tokens)
const EMBEDDING_COST_PER_1M: Record<'openai' | 'gemini', number> = {
  openai: 0.02,
  gemini: 0.15,
};

const EMBEDDING_BATCH_SIZE = 100;

export interface EmbeddingResult {
  /** One unit-normalized vector per input text, in input order. */
  embeddings: number[][];
  provider: 'openai' | 'gemini';
  model: string;
  tokensIn: number;
}

function pickEmbeddingProvider(): 'openai' | 'gemini' {
  if (process.env['OPENAI_API_KEY']) return 'openai';
  if (process.env['GEMINI_API_KEY']) return 'gemini';
  throw new Error('Embeddings need OPENAI_API_KEY or GEMINI_API_KEY');
}

function unitNorm(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  const provider = pickEmbeddingProvider();
  const model = EMBEDDING_MODELS[provider];
  const client = provider === 'openai' ? getOpenAI() : getGemini();

  const adapter = _cacheAdapter;
  const embTtl = envInt('AI_EMBEDDING_CACHE_TTL_SECONDS', 30 * 24 * 60 * 60); // 30 days

  const embeddings: number[][] = new Array(texts.length);
  let tokensIn = 0;
  let cachedCount = 0;

  // ── Per-text cache lookup (reassemble in order) ────────────────────────────
  const missIndices: number[] = [];
  const missTexts: string[] = [];

  if (adapter) {
    await Promise.all(texts.map(async (text, idx) => {
      const key = aiCacheKey({ kind: 'embedding', model, payload: text });
      try {
        const raw = await adapter.get(key);
        if (raw) {
          embeddings[idx] = JSON.parse(raw) as number[];
          cachedCount++;
          return;
        }
      } catch { /* cache miss on error */ }
      missIndices.push(idx);
      missTexts.push(text);
    }));
  } else {
    missIndices.push(...texts.map((_, i) => i));
    missTexts.push(...texts);
  }

  // ── Emit cache-hit usage for the texts we served from cache ───────────────
  if (cachedCount > 0) {
    try {
      usageListener?.({
        provider,
        model,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        fromCache: true,
        cacheKind: 'embedding',
      });
    } catch { /* noop */ }
  }

  // ── Fetch misses from the provider in batches ──────────────────────────────
  for (let i = 0; i < missTexts.length; i += EMBEDDING_BATCH_SIZE) {
    const batchTexts = missTexts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchIndices = missIndices.slice(i, i + EMBEDDING_BATCH_SIZE);
    const release = await getSemaphore().acquire();
    try {
      let lastErr: unknown;
      let response: OpenAI.CreateEmbeddingResponse | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await client.embeddings.create({ model, input: batchTexts, dimensions: EMBEDDING_DIMS });
          break;
        } catch (err) {
          lastErr = err;
          const status = (err as { status?: number }).status ?? 0;
          if (status !== 429 && status < 500) throw err;
          await new Promise((r) => setTimeout(r, 1000 * 4 ** attempt));
        }
      }
      if (!response) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

      // The API may return items out of order — index is authoritative
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      const batchVectors = ordered.map((d) => unitNorm(d.embedding));
      const batchTokens = response.usage?.prompt_tokens ?? batchTexts.reduce((s, t) => s + estimateTokens(t), 0);

      for (let j = 0; j < batchIndices.length; j++) {
        const origIdx = batchIndices[j]!;
        const vec = batchVectors[j]!;
        embeddings[origIdx] = vec;
        // Store in cache per-text
        if (adapter) {
          const key = aiCacheKey({ kind: 'embedding', model, payload: batchTexts[j]! });
          try { await adapter.set(key, JSON.stringify(vec), embTtl); } catch { /* noop */ }
        }
      }
      tokensIn += batchTokens;
    } finally {
      release();
    }
  }

  // Same ledger as chat calls (§12.2.8) — no embedding goes unmetered
  try {
    usageListener?.({
      provider,
      model,
      tokensIn,
      tokensOut: 0,
      costUsd: (tokensIn / 1_000_000) * EMBEDDING_COST_PER_1M[provider],
    });
  } catch { /* noop */ }

  return { embeddings, provider, model, tokensIn };
}

// ── Routing Simulation (Phase 5 §16 dry-run) ──────────────────────────────────
//
// Reuses the live provider health snapshot and cost table to predict routing
// without making any provider call.  The API admin endpoint calls this; the
// function is pure (no side-effects, no I/O) so it is safe to call at any time.

export interface RoutingCandidate {
  provider: AIProvider;
  model: string;
  healthy: boolean;
  estCostUsd: number;
  wouldRoute: boolean;
  reason?: string;
}

/**
 * Simulate provider selection for a given task kind and token budget.
 * Returns one entry per known provider, ordered by descending health score
 * (i.e. routing preference).  `wouldRoute` is true for the first healthy
 * candidate that would actually be selected.
 *
 * @param taskKind  Maps to a model choice (e.g. 'chat' → default model per provider).
 * @param estTokensIn  Estimated input tokens (used for cost projection).
 * @param estTokensOut Estimated output tokens (used for cost projection).
 */
export function simulateRouting(
  taskKind: string, // reserved for future model-selection rules; currently determines display name
  estTokensIn: number,
  estTokensOut: number,
): RoutingCandidate[] {
  const allProviders: AIProvider[] = ['anthropic', 'openai', 'gemini'];
  const defaultModels: Record<AIProvider, string> = {
    anthropic: DEFAULT_ANTHROPIC_MODEL,
    openai: DEFAULT_OPENAI_MODEL,
    gemini: DEFAULT_GEMINI_MODEL,
  };

  const ranked = rankProviders(allProviders);
  let routeAssigned = false;

  return ranked.map((provider) => {
    const model = defaultModels[provider];
    const h = getHealth(provider);
    const available = isProviderAvailable(provider);
    const estCostUsd = estimateCost(provider, estTokensIn, estTokensOut);

    let wouldRoute = false;
    let reason: string | undefined;

    if (!available) {
      reason = `On cooldown (score=${h.score}, consecutiveFailures=${h.consecutiveFailures})`;
    } else if (!routeAssigned) {
      wouldRoute = true;
      routeAssigned = true;
    } else {
      reason = 'Lower priority — a higher-scored provider would route first';
    }

    return { provider, model, healthy: available, estCostUsd, wouldRoute, reason };
  });
}
