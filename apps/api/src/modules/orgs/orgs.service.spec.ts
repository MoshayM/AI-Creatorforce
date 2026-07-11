import {
  buildUsageReport,
  currentPeriodFor,
  orgRoleAllows,
  parseOrgSpendKey,
  remainingCredits,
  rolloverWindows,
  spendDecision,
  usageReportCsv,
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

// ── rolloverWindows ───────────────────────────────────────────────────────────

describe('rolloverWindows', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const period = (startIso: string, days: number) => {
    const periodStart = new Date(startIso);
    return { periodStart, periodEnd: new Date(periodStart.getTime() + days * DAY) };
  };

  it('returns [] while the latest period is still open', () => {
    const latest = period('2026-07-01T00:00:00Z', 30);
    expect(rolloverWindows(latest, new Date('2026-07-15T00:00:00Z'))).toEqual([]);
  });

  it('returns [] for a non-positive duration (corrupt period)', () => {
    const latest = { periodStart: new Date('2026-07-10T00:00:00Z'), periodEnd: new Date('2026-07-01T00:00:00Z') };
    expect(rolloverWindows(latest, new Date('2026-08-01T00:00:00Z'))).toEqual([]);
  });

  it('opens exactly one successor when the period just ended', () => {
    const latest = period('2026-06-01T00:00:00Z', 30);
    const windows = rolloverWindows(latest, new Date('2026-07-02T00:00:00Z'));
    expect(windows).toHaveLength(1);
    expect(windows[0].periodStart).toEqual(latest.periodEnd);
    expect(windows[0].periodEnd.getTime() - windows[0].periodStart.getTime()).toBe(30 * DAY);
  });

  it('successor starts exactly at the previous periodEnd (no gap, no overlap)', () => {
    const latest = period('2026-06-01T00:00:00Z', 30);
    const windows = rolloverWindows(latest, new Date('2026-09-15T00:00:00Z'));
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].periodStart).toEqual(windows[i - 1].periodEnd);
    }
  });

  it('backfills multiple missed windows until one contains now', () => {
    const latest = period('2026-01-01T00:00:00Z', 30);
    const now = new Date('2026-04-15T00:00:00Z'); // ~3.5 windows past periodEnd
    const windows = rolloverWindows(latest, now);
    const last = windows[windows.length - 1];
    expect(last.periodStart.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(last.periodEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  it('caps catch-up at maxPeriods for a very stale period', () => {
    const latest = period('2020-01-01T00:00:00Z', 30);
    const windows = rolloverWindows(latest, new Date('2026-07-11T00:00:00Z'), 12);
    expect(windows).toHaveLength(12);
  });
});

// ── parseOrgSpendKey ──────────────────────────────────────────────────────────

describe('parseOrgSpendKey', () => {
  it('parses a standard key', () => {
    expect(parseOrgSpendKey('org-spend:org1:user1:chat:1752200000000')).toEqual({
      orgId: 'org1',
      memberUserId: 'user1',
      action: 'chat',
    });
  });

  it('keeps colons inside the action segment', () => {
    expect(parseOrgSpendKey('org-spend:org1:user1:video:render:1752200000000')).toEqual({
      orgId: 'org1',
      memberUserId: 'user1',
      action: 'video:render',
    });
  });

  it('rejects keys from other writers', () => {
    expect(parseOrgSpendKey('recharge:org1:user1:chat:1752200000000')).toBeNull();
    expect(parseOrgSpendKey('copilot-turn-abc123')).toBeNull();
  });

  it('rejects keys with a non-numeric trailing segment', () => {
    expect(parseOrgSpendKey('org-spend:org1:user1:chat:not-a-ts')).toBeNull();
  });

  it('rejects truncated keys', () => {
    expect(parseOrgSpendKey('org-spend:org1:user1')).toBeNull();
  });
});

// ── buildUsageReport ──────────────────────────────────────────────────────────

describe('buildUsageReport', () => {
  const members = [
    { userId: 'u1', teamId: 't1', role: 'MEMBER', email: 'u1@x.com' },
    { userId: 'u2', teamId: null, role: 'ORG_ADMIN', email: 'u2@x.com' },
  ];
  const key = (user: string, action: string, ts: number) => `org-spend:org1:${user}:${action}:${ts}`;

  it('groups reservations per member and action', () => {
    const report = buildUsageReport(
      [
        { idempotencyKey: key('u1', 'chat', 1), amount: 10, status: 'HELD', settledCredits: null },
        { idempotencyKey: key('u1', 'chat', 2), amount: 15, status: 'HELD', settledCredits: null },
        { idempotencyKey: key('u1', 'render', 3), amount: 40, status: 'HELD', settledCredits: null },
        { idempotencyKey: key('u2', 'chat', 4), amount: 5, status: 'HELD', settledCredits: null },
      ],
      members,
    );
    expect(report.totalCredits).toBe(70);
    expect(report.reservationCount).toBe(4);
    const u1 = report.byMember.find((r) => r.userId === 'u1')!;
    expect(u1.actions['chat']).toEqual({ credits: 25, count: 2 });
    expect(u1.actions['render']).toEqual({ credits: 40, count: 1 });
    expect(u1.teamId).toBe('t1');
    expect(u1.email).toBe('u1@x.com');
  });

  it('uses settledCredits (not the reserved amount) for SETTLED holds', () => {
    const report = buildUsageReport(
      [{ idempotencyKey: key('u1', 'chat', 1), amount: 100, status: 'SETTLED', settledCredits: 60 }],
      members,
    );
    expect(report.totalCredits).toBe(60);
  });

  it('falls back to amount when a SETTLED hold has no settledCredits', () => {
    const report = buildUsageReport(
      [{ idempotencyKey: key('u1', 'chat', 1), amount: 100, status: 'SETTLED', settledCredits: null }],
      members,
    );
    expect(report.totalCredits).toBe(100);
  });

  it('keeps usage of removed members with role REMOVED', () => {
    const report = buildUsageReport(
      [{ idempotencyKey: key('ghost', 'chat', 1), amount: 30, status: 'HELD', settledCredits: null }],
      members,
    );
    const ghost = report.byMember.find((r) => r.userId === 'ghost')!;
    expect(ghost.role).toBe('REMOVED');
    expect(ghost.totalCredits).toBe(30);
  });

  it('ignores non-orgSpend reservations on the same wallet', () => {
    const report = buildUsageReport(
      [{ idempotencyKey: 'recharge:xyz', amount: 500, status: 'SETTLED', settledCredits: 500 }],
      members,
    );
    expect(report.totalCredits).toBe(0);
    expect(report.byMember).toHaveLength(0);
  });

  it('sorts members by total credits descending', () => {
    const report = buildUsageReport(
      [
        { idempotencyKey: key('u1', 'chat', 1), amount: 10, status: 'HELD', settledCredits: null },
        { idempotencyKey: key('u2', 'chat', 2), amount: 90, status: 'HELD', settledCredits: null },
      ],
      members,
    );
    expect(report.byMember.map((r) => r.userId)).toEqual(['u2', 'u1']);
  });
});

// ── usageReportCsv ────────────────────────────────────────────────────────────

describe('usageReportCsv', () => {
  it('emits a header plus one row per member × action', () => {
    const csv = usageReportCsv({
      byMember: [
        {
          userId: 'u1', email: 'u1@x.com', teamId: 't1', role: 'MEMBER',
          actions: { chat: { credits: 25, count: 2 }, render: { credits: 40, count: 1 } },
          totalCredits: 65, count: 3,
        },
      ],
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('userId,email,teamId,role,action,credits,count');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('u1,u1@x.com,t1,MEMBER,chat,25,2');
  });

  it('escapes commas and quotes in fields', () => {
    const csv = usageReportCsv({
      byMember: [
        {
          userId: 'u1', email: 'a,b"c@x.com', teamId: null, role: 'MEMBER',
          actions: { chat: { credits: 1, count: 1 } },
          totalCredits: 1, count: 1,
        },
      ],
    });
    expect(csv).toContain('"a,b""c@x.com"');
  });
});
