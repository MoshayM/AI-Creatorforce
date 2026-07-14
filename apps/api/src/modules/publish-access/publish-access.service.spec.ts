import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PublishAccessService, PublishAccessStatus, viaRole } from './publish-access.service';

// ── Pure helper ───────────────────────────────────────────────────────────────

describe('viaRole', () => {
  it('returns true for SUPER_ADMIN', () => {
    expect(viaRole('SUPER_ADMIN')).toBe(true);
  });

  it('returns true for OWNER', () => {
    expect(viaRole('OWNER')).toBe(true);
  });

  it('returns false for MEMBER', () => {
    expect(viaRole('MEMBER')).toBe(false);
  });
});

// ── Service with mocked PrismaService ─────────────────────────────────────────

function makeRow(
  userId: string,
  status: PublishAccessStatus,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'grant-1',
    userId,
    status,
    note: null,
    requestedAt: new Date(),
    decidedAt: null,
    decidedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function svc(mockRepo: {
  findUnique?: jest.Mock;
  upsert?: jest.Mock;
  update?: jest.Mock;
  findMany?: jest.Mock;
}): PublishAccessService {
  const prisma = {
    publishAccessGrant: {
      findUnique: mockRepo.findUnique ?? jest.fn().mockResolvedValue(null),
      upsert: mockRepo.upsert ?? jest.fn(),
      update: mockRepo.update ?? jest.fn(),
      findMany: mockRepo.findMany ?? jest.fn().mockResolvedValue([]),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @reason: test-only mock bypass
  return new PublishAccessService(prisma as any);
}

// ── canPublishDirect ──────────────────────────────────────────────────────────

describe('canPublishDirect', () => {
  it('returns true for OWNER without any DB row (via role)', async () => {
    const service = svc({ findUnique: jest.fn() }); // should not be called
    await expect(service.canPublishDirect('user-1', 'OWNER')).resolves.toBe(true);
  });

  it('returns true for SUPER_ADMIN without any DB row (via role)', async () => {
    const service = svc({ findUnique: jest.fn() });
    await expect(service.canPublishDirect('user-1', 'SUPER_ADMIN')).resolves.toBe(true);
  });

  it('returns false for MEMBER with no DB row', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = svc({ findUnique });
    await expect(service.canPublishDirect('user-1', 'MEMBER')).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('returns true for MEMBER with a GRANTED row', async () => {
    const row = makeRow('user-1', PublishAccessStatus.GRANTED);
    const findUnique = jest.fn().mockResolvedValue(row);
    const service = svc({ findUnique });
    await expect(service.canPublishDirect('user-1', 'MEMBER')).resolves.toBe(true);
  });

  it('returns false for MEMBER with a REQUESTED row (not yet approved)', async () => {
    const row = makeRow('user-1', PublishAccessStatus.REQUESTED);
    const findUnique = jest.fn().mockResolvedValue(row);
    const service = svc({ findUnique });
    await expect(service.canPublishDirect('user-1', 'MEMBER')).resolves.toBe(false);
  });
});

// ── assertCanPublishDirect ────────────────────────────────────────────────────

describe('assertCanPublishDirect', () => {
  it('resolves without throwing for OWNER', async () => {
    const service = svc({});
    await expect(service.assertCanPublishDirect('user-1', 'OWNER')).resolves.toBeUndefined();
  });

  it('throws ForbiddenException for MEMBER without a grant', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = svc({ findUnique });
    await expect(service.assertCanPublishDirect('user-1', 'MEMBER')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertCanPublishDirect('user-1', 'MEMBER')).rejects.toMatchObject({
      message: 'Direct publishing to YouTube requires publish access. Use Edit & Download, or request access from your admin.',
    });
  });
});

// ── request lifecycle ─────────────────────────────────────────────────────────

describe('request', () => {
  it('throws BadRequestException for OWNER (already has access via role)', async () => {
    const service = svc({});
    await expect(service.request('user-1', 'OWNER')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.request('user-1', 'OWNER')).rejects.toMatchObject({ message: 'You already have publish access.' });
  });

  it('returns existing row unchanged when status is already GRANTED', async () => {
    const existing = makeRow('user-1', PublishAccessStatus.GRANTED);
    const findUnique = jest.fn().mockResolvedValue(existing);
    const upsert = jest.fn();
    const service = svc({ findUnique, upsert });
    const result = await service.request('user-1', 'MEMBER');
    expect(result).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns existing row unchanged when status is already REQUESTED', async () => {
    const existing = makeRow('user-1', PublishAccessStatus.REQUESTED);
    const findUnique = jest.fn().mockResolvedValue(existing);
    const upsert = jest.fn();
    const service = svc({ findUnique, upsert });
    const result = await service.request('user-1', 'MEMBER');
    expect(result).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts a REQUESTED row when no row exists', async () => {
    const newRow = makeRow('user-1', PublishAccessStatus.REQUESTED);
    const findUnique = jest.fn().mockResolvedValue(null);
    const upsert = jest.fn().mockResolvedValue(newRow);
    const service = svc({ findUnique, upsert });
    const result = await service.request('user-1', 'MEMBER');
    expect(result).toBe(newRow);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({ status: PublishAccessStatus.REQUESTED }),
        update: expect.objectContaining({ status: PublishAccessStatus.REQUESTED }),
      }),
    );
  });

  it('upserts a REQUESTED row when previous row was DENIED or REVOKED', async () => {
    const deniedRow = makeRow('user-1', PublishAccessStatus.DENIED);
    const newRow = makeRow('user-1', PublishAccessStatus.REQUESTED);
    const findUnique = jest.fn().mockResolvedValue(deniedRow);
    const upsert = jest.fn().mockResolvedValue(newRow);
    const service = svc({ findUnique, upsert });
    await service.request('user-1', 'MEMBER');
    expect(upsert).toHaveBeenCalled();
  });
});

// ── decide ────────────────────────────────────────────────────────────────────

describe('decide', () => {
  it('approves a REQUESTED grant → GRANTED', async () => {
    const row = makeRow('user-2', PublishAccessStatus.REQUESTED);
    const updated = makeRow('user-2', PublishAccessStatus.GRANTED, { decidedById: 'admin-1' });
    const findUnique = jest.fn().mockResolvedValue(row);
    const update = jest.fn().mockResolvedValue(updated);
    const service = svc({ findUnique, update });
    const result = await service.decide('user-2', true, 'admin-1');
    expect(result.status).toBe(PublishAccessStatus.GRANTED);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PublishAccessStatus.GRANTED, decidedById: 'admin-1' }),
      }),
    );
  });

  it('denies a REQUESTED grant → DENIED', async () => {
    const row = makeRow('user-2', PublishAccessStatus.REQUESTED);
    const updated = makeRow('user-2', PublishAccessStatus.DENIED, { decidedById: 'admin-1' });
    const findUnique = jest.fn().mockResolvedValue(row);
    const update = jest.fn().mockResolvedValue(updated);
    const service = svc({ findUnique, update });
    const result = await service.decide('user-2', false, 'admin-1');
    expect(result.status).toBe(PublishAccessStatus.DENIED);
  });

  it('throws BadRequestException when no row exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = svc({ findUnique });
    await expect(service.decide('user-2', true, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when row is already GRANTED (not REQUESTED)', async () => {
    const row = makeRow('user-2', PublishAccessStatus.GRANTED);
    const findUnique = jest.fn().mockResolvedValue(row);
    const service = svc({ findUnique });
    await expect(service.decide('user-2', true, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when row is DENIED (not REQUESTED)', async () => {
    const row = makeRow('user-2', PublishAccessStatus.DENIED);
    const findUnique = jest.fn().mockResolvedValue(row);
    const service = svc({ findUnique });
    await expect(service.decide('user-2', true, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── revoke ────────────────────────────────────────────────────────────────────

describe('revoke', () => {
  it('revokes a GRANTED row → REVOKED', async () => {
    const row = makeRow('user-3', PublishAccessStatus.GRANTED);
    const updated = makeRow('user-3', PublishAccessStatus.REVOKED, { decidedById: 'admin-1' });
    const findUnique = jest.fn().mockResolvedValue(row);
    const update = jest.fn().mockResolvedValue(updated);
    const service = svc({ findUnique, update });
    const result = await service.revoke('user-3', 'admin-1');
    expect(result.status).toBe(PublishAccessStatus.REVOKED);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PublishAccessStatus.REVOKED, decidedById: 'admin-1' }),
      }),
    );
  });

  it('throws BadRequestException when no row exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = svc({ findUnique });
    await expect(service.revoke('user-3', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when row is REQUESTED (not GRANTED)', async () => {
    const row = makeRow('user-3', PublishAccessStatus.REQUESTED);
    const findUnique = jest.fn().mockResolvedValue(row);
    const service = svc({ findUnique });
    await expect(service.revoke('user-3', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── full lifecycle ────────────────────────────────────────────────────────────

describe('full request → approve → revoke lifecycle', () => {
  it('models state transitions correctly using individual mocks', async () => {
    // Step 1: request
    const noRow = jest.fn().mockResolvedValue(null);
    const requestedRow = makeRow('member-1', PublishAccessStatus.REQUESTED);
    const upsert = jest.fn().mockResolvedValue(requestedRow);
    const requestSvc = svc({ findUnique: noRow, upsert });
    const req = await requestSvc.request('member-1', 'MEMBER');
    expect(req.status).toBe(PublishAccessStatus.REQUESTED);

    // Step 2: approve
    const requestedLookup = jest.fn().mockResolvedValue(requestedRow);
    const grantedRow = makeRow('member-1', PublishAccessStatus.GRANTED);
    const updateApprove = jest.fn().mockResolvedValue(grantedRow);
    const approveSvc = svc({ findUnique: requestedLookup, update: updateApprove });
    const granted = await approveSvc.decide('member-1', true, 'admin-1');
    expect(granted.status).toBe(PublishAccessStatus.GRANTED);

    // Step 3: revoke
    const grantedLookup = jest.fn().mockResolvedValue(grantedRow);
    const revokedRow = makeRow('member-1', PublishAccessStatus.REVOKED);
    const updateRevoke = jest.fn().mockResolvedValue(revokedRow);
    const revokeSvc = svc({ findUnique: grantedLookup, update: updateRevoke });
    const revoked = await revokeSvc.revoke('member-1', 'admin-1');
    expect(revoked.status).toBe(PublishAccessStatus.REVOKED);
  });
});
