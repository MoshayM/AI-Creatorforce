import { BillingJobsService } from './billing-jobs.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { BillingService } from './billing.service';

function makeService(opts: {
  wallets: Array<{ id: string; userId: string; balanceCredits: number }>;
  ledgerSums: Array<{ walletId: string; _sum: { amount: number | null } }>;
  staleHolds?: number;
}) {
  const audits: unknown[] = [];
  const prisma = {
    wallet: { findMany: jest.fn().mockResolvedValue(opts.wallets) },
    creditLedger: { groupBy: jest.fn().mockResolvedValue(opts.ledgerSums) },
    creditReservation: { updateMany: jest.fn().mockResolvedValue({ count: opts.staleHolds ?? 0 }) },
    auditLog: {
      create: jest.fn(({ data }: { data: unknown }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  } as unknown as PrismaService;
  const billing = { reconcilePendingPayments: jest.fn() } as unknown as BillingService;
  return { service: new BillingJobsService(prisma, billing), audits, prisma };
}

describe('BillingJobsService.reconcileLedger — §5.5 cache vs ledger', () => {
  it('passes silently when every wallet matches its ledger sum', async () => {
    const { service, audits } = makeService({
      wallets: [{ id: 'w1', userId: 'u1', balanceCredits: 500 }],
      ledgerSums: [{ walletId: 'w1', _sum: { amount: 500 } }],
    });
    const res = await service.reconcileLedger();
    expect(res).toEqual({ checked: 1, mismatches: 0 });
    expect(audits).toHaveLength(0);
  });

  it('raises a P1 audit row per drifted wallet with the drift amount', async () => {
    const { service, audits } = makeService({
      wallets: [
        { id: 'w1', userId: 'u1', balanceCredits: 500 },
        { id: 'w2', userId: 'u2', balanceCredits: 90 },
      ],
      ledgerSums: [
        { walletId: 'w1', _sum: { amount: 500 } },
        { walletId: 'w2', _sum: { amount: 100 } },
      ],
    });
    const res = await service.reconcileLedger();
    expect(res.mismatches).toBe(1);
    expect(audits[0]).toMatchObject({
      action: 'system:ledger-mismatch',
      target: 'w2',
      meta: { cachedBalance: 90, ledgerSum: 100, driftedBy: -10 },
    });
  });

  it('treats a wallet with no ledger rows as ledger sum 0', async () => {
    const { service } = makeService({
      wallets: [{ id: 'w1', userId: 'u1', balanceCredits: 0 }],
      ledgerSums: [],
    });
    expect((await service.reconcileLedger()).mismatches).toBe(0);
  });
});

describe('BillingJobsService.sweepStaleReservations', () => {
  it('releases expired HELD rows and reports the count', async () => {
    const { service, prisma } = makeService({ wallets: [], ledgerSums: [], staleHolds: 3 });
    expect(await service.sweepStaleReservations()).toBe(3);
    expect((prisma.creditReservation.updateMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { status: 'HELD' },
      data: { status: 'RELEASED' },
    });
  });
});
