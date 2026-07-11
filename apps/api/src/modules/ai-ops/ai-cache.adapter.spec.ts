/**
 * Tests for the AI cache adapter and the pure aiCacheKey helper.
 * AiCacheAdapter wraps Redis: we verify that get/set never throw even when
 * the underlying Redis client throws.
 * aiCacheKey tests verify determinism, kind prefixing, and payload sensitivity.
 */

import { aiCacheKey } from '@cf/shared';

// ---------------------------------------------------------------------------
// aiCacheKey — pure function tests
// ---------------------------------------------------------------------------

describe('aiCacheKey — determinism and key shape', () => {
  const base = { kind: 'response' as const, model: 'claude-sonnet-4-6', system: 'You are helpful.', payload: 'Hello' };

  it('returns the same key for identical inputs', () => {
    expect(aiCacheKey(base)).toBe(aiCacheKey({ ...base }));
  });

  it('prefixes response keys with ai:resp:', () => {
    expect(aiCacheKey(base)).toMatch(/^ai:resp:/);
  });

  it('prefixes embedding keys with ai:emb:', () => {
    const key = aiCacheKey({ kind: 'embedding', model: 'text-embedding-3-small', payload: 'embed me' });
    expect(key).toMatch(/^ai:emb:/);
  });

  it('produces different keys for different models', () => {
    const a = aiCacheKey({ ...base, model: 'gpt-4o' });
    const b = aiCacheKey({ ...base, model: 'claude-sonnet-4-6' });
    expect(a).not.toBe(b);
  });

  it('produces different keys for different system prompts', () => {
    const a = aiCacheKey({ ...base, system: 'Be concise.' });
    const b = aiCacheKey({ ...base, system: 'Be verbose.' });
    expect(a).not.toBe(b);
  });

  it('produces different keys for different payloads', () => {
    const a = aiCacheKey({ ...base, payload: 'What is the capital of France?' });
    const b = aiCacheKey({ ...base, payload: 'What is the capital of Germany?' });
    expect(a).not.toBe(b);
  });

  it('treats undefined system as empty string — stable between undefined and omitted', () => {
    const withUndefined = aiCacheKey({ kind: 'response', model: 'm', payload: 'p', system: undefined });
    const withOmitted   = aiCacheKey({ kind: 'response', model: 'm', payload: 'p' });
    expect(withUndefined).toBe(withOmitted);
  });

  it('differentiates response vs embedding keys even for same model+payload', () => {
    const resp = aiCacheKey({ kind: 'response', model: 'm', payload: 'x' });
    const emb  = aiCacheKey({ kind: 'embedding', model: 'm', payload: 'x' });
    expect(resp).not.toBe(emb);
  });
});

// ---------------------------------------------------------------------------
// AiCacheAdapter — resilience against Redis failures
// ---------------------------------------------------------------------------

// Minimal mock Redis that can be made to throw
class ThrowingRedis {
  shouldThrow = false;
  ready = false;
  private errorCb?: () => void;
  private readyCb?: () => void;

  on(event: string, cb: () => void): this {
    if (event === 'error') this.errorCb = cb;
    if (event === 'ready') this.readyCb = cb;
    return this;
  }

  triggerError(): void { this.errorCb?.(); }
  triggerReady(): void { this.readyCb?.(); this.ready = true; }

  async get(_key: string): Promise<string | null> {
    if (this.shouldThrow) throw new Error('Redis connection refused');
    return null;
  }

  async set(_key: string, _value: string, _mode: string, _ttl: number): Promise<'OK'> {
    if (this.shouldThrow) throw new Error('Redis write error');
    return 'OK';
  }

  async quit(): Promise<void> {}
}

// We import the adapter class directly and replace its redis instance via
// module internals — the class is tested in isolation, no NestJS DI needed.
import { AiCacheAdapter } from './ai-cache.adapter';

function makeAdapter(throwingRedis: ThrowingRedis): AiCacheAdapter {
  const adapter = new AiCacheAdapter();
  // Replace the redis property (it's created in constructor before the test mocks it,
  // so we patch post-construction using bracket notation access).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only internals
  (adapter as any).redis = throwingRedis;
  // Mark available so the availability guard doesn't short-circuit before Redis can throw
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only internals
  (adapter as any).available = true;
  return adapter;
}

describe('AiCacheAdapter — never throws when Redis throws', () => {
  it('get returns null when Redis throws', async () => {
    const redis = new ThrowingRedis();
    redis.shouldThrow = true;
    const adapter = makeAdapter(redis);

    await expect(adapter.get('some:key')).resolves.toBeNull();
  });

  it('set resolves (does not throw) when Redis throws', async () => {
    const redis = new ThrowingRedis();
    redis.shouldThrow = true;
    const adapter = makeAdapter(redis);

    await expect(adapter.set('some:key', '{"x":1}', 3600)).resolves.toBeUndefined();
  });

  it('get returns null when adapter marks itself unavailable', async () => {
    const adapter = new AiCacheAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).available = false;
    await expect(adapter.get('key')).resolves.toBeNull();
  });

  it('set is a no-op when adapter marks itself unavailable', async () => {
    const adapter = new AiCacheAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).available = false;
    await expect(adapter.set('key', 'val', 100)).resolves.toBeUndefined();
  });
});
