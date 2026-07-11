import {
  currentPeriodFor,
  orgRoleAllows,
  remainingCredits,
  spendDecision,
  type OrgAction,
  type SpendDecision,
} from './orgs.service';

// ── orgRoleAllows matrix ──────────────────────────────────────────────────────

describe('orgRoleAllows', () => {
  const actions: OrgAction[] = ['MANAGE_ORG', 'MANAGE_BUDGET', 'SPEND', 'VIEW_REPORTS'];

  describe('ORG_ADMIN', () => {
    it.each(actions)('allows %s', (action) => {
      expect(orgRoleAllows('ORG_ADMIN', action)).toBe(true);
    });
  });

  describe('BILLING_ADMIN', () => {
    it('allows MANAGE_BUDGET', () => expect(orgRoleAllows('BILLING_ADMIN', 'MANAGE_BUDGET')).toBe(true));
    it('allows VIEW_REPORTS',  () => expect(orgRoleAllows('BILLING_ADMIN', 'VIEW_REPORTS')).toBe(true));
    it('allows SPEND',         () => expect(orgRoleAllows('BILLING_ADMIN', 'SPEND')).toBe(true));
    it('denies MANAGE_ORG',    () => expect(orgRoleAllows('BILLING_ADMIN', 'MANAGE_ORG')).toBe(false));
  });

  describe('TEAM_MANAGER', () => {
    it('allows SPEND',          () => expect(orgRoleAllows('TEAM_MANAGER', 'SPEND')).toBe(true));
    it('allows VIEW_REPORTS',   () => expect(orgRoleAllows('TEAM_MANAGER', 'VIEW_REPORTS')).toBe(true));
    it('denies MANAGE_ORG',     () => expect(orgRoleAllows('TEAM_MANAGER', 'MANAGE_ORG')).toBe(false));
    it('denies MANAGE_BUDGET',  () => expect(orgRoleAllows('TEAM_MANAGER', 'MANAGE_BUDGET')).toBe(false));
  });

  describe('MEMBER', () => {
    it('allows SPEND',          () => expect(orgRoleAllows('MEMBER', 'SPEND')).toBe(true));
    it('denies MANAGE_ORG',     () => expect(orgRoleAllows('MEMBER', 'MANAGE_ORG')).toBe(false));
    it('denies MANAGE_BUDGET',  () => expect(orgRoleAllows('MEMBER', 'MANAGE_BUDGET')).toBe(false));
    it('denies VIEW_REPORTS',   () => expect(orgRoleAllows('MEMBER', 'VIEW_REPORTS')).toBe(false));
  });

  describe('unknown role', () => {
    it('denies all', () => {
      for (const action of actions) {
        expect(orgRoleAllows('UNKNOWN', action)).toBe(false);
      }
    });
  });
});

// ── currentPeriodFor ──────────────────────────────────────────────────────────

describe('currentPeriodFor', () => {
  const jan1 = new Date('2026-01-01T00:00:00Z');
  const jan15 = new Date('2026-01-15T00:00:00Z');
  const feb1 = new Date('2026-02-01T00:00:00Z');
  const mar1 = new Date('2026-03-01T00:00:00Z');

  const periods = [
    { periodStart: jan1, periodEnd: feb1 },
    { periodStart: feb1, periodEnd: mar1 },
  ];

  it('finds period containing now (January)', () => {
    expect(currentPeriodFor(periods, jan15)).toBe(0);
  });

  it('finds period containing now (February)', () => {
    const feb15 = new Date('2026-02-15T00:00:00Z');
    expect(currentPeriodFor(periods, feb15)).toBe(1);
  });

  it('returns -1 before all periods', () => {
    const dec31 = new Date('2025-12-31T23:59:59Z');
    expect(currentPeriodFor(periods, dec31)).toBe(-1);
  });

  it('returns -1 after all periods', () => {
    const apr1 = new Date('2026-04-01T00:00:00Z');
    expect(currentPeriodFor(periods, apr1)).toBe(-1);
  });

  it('boundary: periodStart is inclusive', () => {
    // now === periodStart → inside
    expect(currentPeriodFor(periods, jan1)).toBe(0);
  });

  it('boundary: periodEnd is exclusive', () => {
    // now === periodEnd → outside (belongs to next period or none)
    expect(currentPeriodFor(periods, feb1)).toBe(1);
  });

  it('returns first match when periods overlap', () => {
    const overlapping = [
      { periodStart: jan1, periodEnd: mar1 },  // index 0 (wider)
      { periodStart: jan1, periodEnd: feb1 },  // index 1 (narrower)
    ];
    expect(currentPeriodFor(overlapping, jan15)).toBe(0);
  });

  it('returns -1 for empty array', () => {
    expect(currentPeriodFor([], jan15)).toBe(-1);
  });
});

// ── remainingCredits ──────────────────────────────────────────────────────────

describe('remainingCredits', () => {
  it('returns difference when not exceeded', () => {
    expect(remainingCredits(1000, 300)).toBe(700);
  });

  it('returns 0 when exactly at limit', () => {
    expect(remainingCredits(500, 500)).toBe(0);
  });

  it('returns 0 (not negative) when consumed exceeds allocated', () => {
    expect(remainingCredits(100, 150)).toBe(0);
  });

  it('returns full allocation when nothing consumed', () => {
    expect(remainingCredits(200, 0)).toBe(200);
  });
});

// ── spendDecision ─────────────────────────────────────────────────────────────

describe('spendDecision', () => {
  const base = {
    hardCap: false,
    remaining: 500,
    amount: 50,
    approvalRequired: false,
    approvalThreshold: 100,
  };

  it('ALLOW when amount fits and no approval required', () => {
    expect(spendDecision(base)).toBe<SpendDecision>('ALLOW');
  });

  it('BLOCK_BUDGET when hardCap and amount > remaining', () => {
    expect(spendDecision({ ...base, hardCap: true, remaining: 40, amount: 50 }))
      .toBe<SpendDecision>('BLOCK_BUDGET');
  });

  it('ALLOW when hardCap but amount === remaining (exact fit)', () => {
    expect(spendDecision({ ...base, hardCap: true, remaining: 50, amount: 50 }))
      .toBe<SpendDecision>('ALLOW');
  });

  it('NEEDS_APPROVAL when approvalRequired and amount >= threshold', () => {
    expect(spendDecision({ ...base, approvalRequired: true, approvalThreshold: 50, amount: 50 }))
      .toBe<SpendDecision>('NEEDS_APPROVAL');
  });

  it('ALLOW when approvalRequired but amount < threshold', () => {
    expect(spendDecision({ ...base, approvalRequired: true, approvalThreshold: 100, amount: 50 }))
      .toBe<SpendDecision>('ALLOW');
  });

  it('BLOCK_BUDGET beats NEEDS_APPROVAL (hardCap takes precedence)', () => {
    // Both conditions met: hardCap exceeded AND approval required
    expect(
      spendDecision({
        hardCap: true,
        remaining: 30,
        amount: 50,
        approvalRequired: true,
        approvalThreshold: 50,
      }),
    ).toBe<SpendDecision>('BLOCK_BUDGET');
  });

  it('soft-cap overspend (no hardCap) is ALLOW', () => {
    // remaining < amount but hardCap=false → should ALLOW, notify caller separately
    expect(spendDecision({ ...base, hardCap: false, remaining: 10, amount: 50 }))
      .toBe<SpendDecision>('ALLOW');
  });
});
