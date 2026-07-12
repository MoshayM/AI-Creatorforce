import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

const MOCK_ORG = {
  id: 'org-1',
  name: 'Acme Studios',
  ownerUserId: 'user-1',
  billingEmail: 'finance@acme.example',
  status: 'ACTIVE',
  role: 'ORG_ADMIN',
};

const MOCK_MEMBERS = [
  { id: 'm-1', orgId: 'org-1', userId: 'user-1', teamId: null, role: 'ORG_ADMIN', approvalRequired: false, email: 'admin@acme.example', name: 'Alice Admin' },
  { id: 'm-2', orgId: 'org-1', userId: 'user-2', teamId: null, role: 'MEMBER', approvalRequired: true, email: 'bob@acme.example', name: 'Bob Builder' },
];

const MOCK_BUDGET = {
  period: {
    id: 'bp-1',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    allocatedCredits: 10_000,
    consumedCredits: 2_500,
    hardCap: true,
  },
  remaining: 7_500,
  orgBalance: 42_000,
};

const MOCK_TEAMS = [
  { id: 'team-1', name: 'Video Production', ownerId: 'user-1', orgId: 'org-1', createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'team-2', name: 'Growth', ownerId: 'user-1', orgId: 'org-1', createdAt: '2026-07-02T00:00:00.000Z' },
];

async function mockOrgRoutes(page: Page, opts?: { orgs?: unknown[]; role?: string; teams?: unknown[] }) {
  const orgs = opts?.orgs ?? [{ ...MOCK_ORG, role: opts?.role ?? 'ORG_ADMIN' }];
  await page.route(`${BASE}/orgs/mine`, (route) => route.fulfill({ json: orgs }));
  await page.route(`${BASE}/orgs/org-1/members`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: MOCK_MEMBERS });
    return route.fulfill({ status: 201, json: MOCK_MEMBERS[1] });
  });
  await page.route(`${BASE}/orgs/org-1/teams`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: opts?.teams ?? [] });
    return route.fulfill({ status: 201, json: MOCK_TEAMS[0] });
  });
  await page.route(/\/api\/v1\/orgs\/org-1\/budget/, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: MOCK_BUDGET });
    return route.fulfill({ json: MOCK_BUDGET.period });
  });
}

test.describe('Organization page', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('empty state shows the create form', async ({ page }) => {
    await mockOrgRoutes(page, { orgs: [] });
    await page.goto('/orgs');
    // exact — the "Create organization" button differs only in case
    await expect(page.getByText('Create Organization', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name')).toBeVisible();
  });

  test('creating an org POSTs /orgs with the entered name', async ({ page }) => {
    await mockOrgRoutes(page, { orgs: [] });
    let posted: Record<string, unknown> | null = null;
    await page.route(`${BASE}/orgs`, (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { ...MOCK_ORG, name: posted['name'] } });
    });
    await page.goto('/orgs');
    await page.getByLabel('Name').fill('Acme Studios');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted!['name']).toBe('Acme Studios');
  });

  test('budget card renders balance, allocation and remaining', async ({ page }) => {
    await mockOrgRoutes(page);
    await page.goto('/orgs');
    await expect(page.getByText('Shared Wallet & Budget')).toBeVisible();
    await expect(page.getByText('42,000')).toBeVisible();
    await expect(page.getByText('10,000')).toBeVisible();
    await expect(page.getByText('7,500')).toBeVisible();
    await expect(page.getByText('hard cap')).toBeVisible();
  });

  test('members table lists names and roles', async ({ page }) => {
    await mockOrgRoutes(page);
    await page.goto('/orgs');
    await expect(page.getByText('Alice Admin')).toBeVisible();
    await expect(page.getByText('Bob Builder')).toBeVisible();
    await expect(page.getByText('manager approval')).toBeVisible();
  });

  test('saving a budget period PUTs the entered allocation', async ({ page }) => {
    await mockOrgRoutes(page);
    let putBody: Record<string, unknown> | null = null;
    await page.route(/\/api\/v1\/orgs\/org-1\/budget/, (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: MOCK_BUDGET.period });
      }
      return route.fulfill({ json: MOCK_BUDGET });
    });
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'New budget period' }).click();
    await page.getByLabel('Period start').fill('2026-08-01');
    await page.getByLabel('Period end').fill('2026-09-01');
    await page.getByLabel('Allocated credits').fill('5000');
    await page.getByRole('button', { name: 'Save period' }).click();
    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody!['allocatedCredits']).toBe(5000);
    expect(putBody!['hardCap']).toBe(true);
  });

  test('MEMBER role sees no add-member or budget-edit controls', async ({ page }) => {
    await mockOrgRoutes(page, { role: 'MEMBER' });
    await page.goto('/orgs');
    await expect(page.getByText('Shared Wallet & Budget')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New budget period' })).toHaveCount(0);
    // Reports need VIEW_REPORTS (ORG_ADMIN/BILLING_ADMIN/TEAM_MANAGER)
    await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  });
});

test.describe('Teams (Wave 8)', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('teams card lists teams and creating one POSTs the name', async ({ page }) => {
    await mockOrgRoutes(page, { teams: MOCK_TEAMS });
    let posted: Record<string, unknown> | null = null;
    await page.route(`${BASE}/orgs/org-1/teams`, (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: { ...MOCK_TEAMS[0], id: 'team-3', name: posted['name'] } });
      }
      return route.fulfill({ json: MOCK_TEAMS });
    });
    await page.goto('/orgs');
    // Scope to the chip list — the sidebar also contains a "Growth" nav link.
    await expect(page.getByRole('listitem').filter({ hasText: 'Video Production' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Growth' })).toBeVisible();
    await page.getByLabel('Team name').fill('Editing');
    await page.getByRole('button', { name: 'Create team' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted!['name']).toBe('Editing');
  });

  test('selecting a team scope GETs budget?teamId and the new period carries it', async ({ page }) => {
    await mockOrgRoutes(page, { teams: MOCK_TEAMS });
    const budgetGets: Array<string | null> = [];
    let putBody: Record<string, unknown> | null = null;
    await page.route(/\/api\/v1\/orgs\/org-1\/budget/, (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: MOCK_BUDGET.period });
      }
      budgetGets.push(new URL(route.request().url()).searchParams.get('teamId'));
      return route.fulfill({ json: MOCK_BUDGET });
    });
    await page.goto('/orgs');
    await page.getByLabel('Budget scope').selectOption('team-1');
    await expect.poll(() => budgetGets.includes('team-1')).toBe(true);

    await page.getByRole('button', { name: 'New budget period' }).click();
    await expect(page.getByText('team "Video Production"')).toBeVisible();
    await page.getByLabel('Period start').fill('2026-08-01');
    await page.getByLabel('Period end').fill('2026-09-01');
    await page.getByLabel('Allocated credits').fill('3000');
    await page.getByRole('button', { name: 'Save period' }).click();
    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody!['teamId']).toBe('team-1');
    expect(putBody!['allocatedCredits']).toBe(3000);
  });

  test('add-member form sends the selected teamId', async ({ page }) => {
    await mockOrgRoutes(page, { teams: MOCK_TEAMS });
    let posted: Record<string, unknown> | null = null;
    await page.route(`${BASE}/orgs/org-1/members`, (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: MOCK_MEMBERS[1] });
      }
      return route.fulfill({ json: MOCK_MEMBERS });
    });
    await page.goto('/orgs');
    await page.getByLabel('Email (must be registered)').fill('new@acme.example');
    await page.getByLabel('Team', { exact: true }).selectOption('team-2');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted!['teamId']).toBe('team-2');
    expect(posted!['email']).toBe('new@acme.example');
  });
});

test.describe('Bill-to-org pickers', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('copilot panel sends the selected orgId with the turn', async ({ page }) => {
    await mockOrgRoutes(page);
    let chatBody: Record<string, unknown> | null = null;
    await page.route(`${BASE}/copilot/chat`, (route) => {
      chatBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { reply: 'Done.' } });
    });
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Open Copilot' }).click();
    const picker = page.getByLabel('Bill to');
    await expect(picker).toBeVisible();
    await picker.selectOption('org-1');
    const input = page.getByPlaceholder('Ask or command…');
    await input.fill('status of my project');
    await input.press('Enter');
    await expect.poll(() => chatBody).not.toBeNull();
    expect(chatBody!['orgId']).toBe('org-1');
  });

  test('project page billing picker PUTs billingOrgId', async ({ page }) => {
    await mockOrgRoutes(page);
    let putBody: Record<string, unknown> | null = null;
    await page.route(/\/api\/v1\/projects\/proj-1$/, (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: {} });
      }
      return route.fallback();
    });
    await page.goto('/projects/proj-1');
    const picker = page.getByLabel('Bill to');
    await expect(picker).toBeVisible();
    await picker.selectOption('org-1');
    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody!['billingOrgId']).toBe('org-1');
  });
});
