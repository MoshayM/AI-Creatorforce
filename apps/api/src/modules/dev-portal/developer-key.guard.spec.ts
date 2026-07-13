import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
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

describe('DeveloperKeyGuard — @PaidAction() gate (Wave 18, risk R-12)', () => {
  let guard: DeveloperKeyGuard;

  beforeEach(() => {
    guard = new DeveloperKeyGuard(
      devPortal as unknown as DevPortalService,
      reflector as unknown as Reflector,
    );
    jest.clearAllMocks();
    reflector.get.mockReturnValue(undefined); // no scope requirement
  });

  const headers = { 'x-api-key': 'cfk_test' };

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
