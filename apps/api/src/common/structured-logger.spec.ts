import { buildLogEntry, redact } from './structured-logger';

describe('redact — Updates/38 "no secrets/PII in logs"', () => {
  it('replaces sensitive keys anywhere in the tree, case-insensitively', () => {
    const input = {
      user: 'u1',
      Password: 'hunter2',
      nested: { apiKey: 'cfk_123', refresh_token: 'r1', ok: 1 },
      list: [{ Authorization: 'Bearer x' }, 'plain'],
    };
    expect(redact(input)).toEqual({
      user: 'u1',
      Password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', refresh_token: '[REDACTED]', ok: 1 },
      list: [{ Authorization: '[REDACTED]' }, 'plain'],
    });
  });

  it('passes primitives through and does not mutate the input', () => {
    expect(redact('secret in a string value is kept')).toBe('secret in a string value is kept');
    const input = { token: 't' };
    redact(input);
    expect(input.token).toBe('t');
  });

  it('stops descending at the depth cap instead of recursing forever', () => {
    type Deep = { child?: Deep; token?: string };
    const root: Deep = {};
    let node = root;
    for (let i = 0; i < 10; i++) {
      node.child = { token: 't' };
      node = node.child;
    }
    expect(() => redact(root)).not.toThrow();
  });
});

describe('buildLogEntry — structured line shape', () => {
  const now = new Date('2026-07-13T00:00:00Z');

  it('carries ts, level, context, msg, and correlationId', () => {
    expect(buildLogEntry('warn', 'cache miss', 'AiCacheAdapter', [], 'corr-1234', now)).toEqual({
      ts: '2026-07-13T00:00:00.000Z',
      level: 'warn',
      context: 'AiCacheAdapter',
      msg: 'cache miss',
      correlationId: 'corr-1234',
    });
  });

  it('omits context and correlationId when absent, and redacts extras', () => {
    const entry = buildLogEntry('error', 'boom', undefined, [{ password: 'x' }], undefined, now);
    expect(entry).toEqual({
      ts: '2026-07-13T00:00:00.000Z',
      level: 'error',
      msg: 'boom',
      detail: { password: '[REDACTED]' },
    });
  });

  it('collects multiple extras (e.g. error stack strings) into detail', () => {
    const entry = buildLogEntry('error', 'boom', 'Ctx', ['stack-line-1', { a: 1 }], 'c1', now);
    expect(entry['detail']).toEqual(['stack-line-1', { a: 1 }]);
  });
});
