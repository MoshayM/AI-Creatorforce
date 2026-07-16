import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

// Prevent the guard's constructor from creating a real ioredis client (which
// would leak an open handle per test); the tests swap in redisMock below.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { DeveloperKeyGuard } from './developer-key.guard';
import type { DevPortalService } from './dev-portal.service';

const devPortal = {
  verifyKey: jest.fn(),
  recordRequest: jest.fn(),
};
const reflector = {
  get: jest.fn(),
  getAllAndOverride: jest.fn(),
};

const redisMock = {
  eval: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
};

function makeGuard(): DeveloperKeyGuard {
  const guard = new DeveloperKeyGuard(
    devPortal as unknown as DevPortalService,
    reflector as unknown as Reflector,
  );
  // Swap the real ioredis client for a mock so unit tests never open a socket.
  (guard as unknown as { redis: typeof redisMock }).redis = redisMock;
  return guard;
}

function contextFor(headers: Record<string, string>): ExecutionContext {
  const request = { headers, header: (n: string) => headers[n.toLowerCase()] };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
  } as unknown as ExecutionContext;
}

const verifiedKey = (sandbox: boolean) => ({
  keyId: 'key-1',
  userId: 'user-1',
  scopes: ['jobs:write'],
  sandbox,
  rateLimitPerMin: 60,
});

const headers = { 'x-api-key': 'cfk_test' };

describe('DeveloperKeyGuard — @PaidAction() gate (Wave 18, risk R-12)', () => {
  let guard: DeveloperKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = makeGuard();
    reflector.get.mockReturnValue(undefined); // no scope requirement
    redisMock.eval.mockResolvedValue(1); // rate limiter admits by default
  });

  it('rejects a sandbox key on a route marked @PaidAction() before the handler runs', async () => {
    devPortal.verifyKey.mockResolvedValue(verifiedKey(true));
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(/sandbox keys cannot run paid/i);
  });

  it('lets a sandbox key through on routes without @PaidAction()', async () => {
    devPortal.verifyKey.mockResolvedValue(verifiedKey(true));
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextFor(headers))).resolves.toBe(true);
  });

  it('lets a live key through on a @PaidAction() route', async () => {
    devPortal.verifyKey.mockResolvedValue(verifiedKey(false));
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextFor(headers))).resolves.toBe(true);
  });
});

describe('DeveloperKeyGuard — Redis sliding-window rate limit', () => {
  let guard: DeveloperKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = makeGuard();
    reflector.get.mockReturnValue(undefined);
    reflector.getAllAndOverride.mockReturnValue(undefined);
    devPortal.verifyKey.mockResolvedValue(verifiedKey(false));
  });

  it('admits the request when the window script returns 1', async () => {
    redisMock.eval.mockResolvedValue(1);

    await expect(guard.canActivate(contextFor(headers))).resolves.toBe(true);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      'ratelimit:devkey:key-1',
      expect.any(Number),
      60_000,
      60,
      expect.any(String),
    );
  });

  it('rejects with 403 when the window script returns 0, and does not record usage', async () => {
    redisMock.eval.mockResolvedValue(0);

    await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(/rate limit exceeded/i);
    expect(devPortal.recordRequest).not.toHaveBeenCalled();
  });

  it('fails open when Redis errors mid-flight', async () => {
    redisMock.eval.mockRejectedValue(new Error('connection refused'));

    await expect(guard.canActivate(contextFor(headers))).resolves.toBe(true);
  });

  it('fails open without calling Redis when the connection is known to be down', async () => {
    (guard as unknown as { redisAvailable: boolean }).redisAvailable = false;

    await expect(guard.canActivate(contextFor(headers))).resolves.toBe(true);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});
