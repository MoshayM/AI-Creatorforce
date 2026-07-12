'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Users, PiggyBank, PlusCircle, Loader2, AlertCircle, Download, ShieldCheck, Layers } from 'lucide-react';
import { api, apiClient, type Org, type OrgMember, type OrgBudgetStatus, type OrgTeam } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// Role → capability mirror of the server's orgRoleAllows (UI hint only — the
// server re-checks every action).
const canManageOrg = (role: string) => role === 'ORG_ADMIN';
const canManageBudget = (role: string) => role === 'ORG_ADMIN' || role === 'BILLING_ADMIN';
const canViewReports = (role: string) => role !== 'MEMBER';

const ROLE_BADGE: Record<string, string> = {
  ORG_ADMIN: 'bg-purple-100 text-purple-700',
  BILLING_ADMIN: 'bg-blue-100 text-blue-700',
  TEAM_MANAGER: 'bg-teal-100 text-teal-700',
  MEMBER: 'bg-gray-100 text-gray-600',
};

// ── Create org form ───────────────────────────────────────────────────────────

function CreateOrgCard({ onCreated }: { onCreated: (org: Org) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.orgs.create({ name: name.trim(), ...(billingEmail.trim() ? { billingEmail: billingEmail.trim() } : {}) }).then((r) => r.data),
    onSuccess: (org) => {
      setName('');
      setBillingEmail('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['orgs-mine'] });
      onCreated(org);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <PlusCircle className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Create Organization</span>
      </div>
      <p className="text-xs text-gray-500">
        An organization has a shared credit wallet and budgets — team members bill AI work to it instead of their personal wallets.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="org-name" className="block text-xs text-gray-600 mb-1">Name</label>
          <input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Studios"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="org-billing-email" className="block text-xs text-gray-600 mb-1">Billing email (optional)</label>
          <input
            id="org-billing-email"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="finance@acme.example"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>
      )}
      <button
        onClick={() => create.mutate()}
        disabled={!name.trim() || create.isPending}
        className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
      >
        {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
        Create organization
      </button>
    </div>
  );
}

// ── Teams hook (shared by budget/members/teams cards; react-query dedupes) ────

function useOrgTeams(orgId: string) {
  return useQuery<OrgTeam[]>({
    queryKey: ['org-teams', orgId],
    queryFn: () => api.orgs.teams(orgId).then((r) => r.data),
  });
}

// ── Budget card ───────────────────────────────────────────────────────────────

function BudgetCard({ org }: { org: Org }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [allocated, setAllocated] = useState('1000');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [hardCap, setHardCap] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: teams = [] } = useOrgTeams(org.id);
  const { data: budget, isLoading } = useQuery<OrgBudgetStatus>({
    queryKey: ['org-budget', org.id, teamId],
    queryFn: () => api.orgs.budget(org.id, teamId || undefined).then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: () =>
      api.orgs.setBudget(org.id, {
        periodStart: new Date(start).toISOString(),
        periodEnd: new Date(end).toISOString(),
        allocatedCredits: parseInt(allocated, 10) || 0,
        hardCap,
        // A period created while a team is selected budgets that team;
        // org-wide otherwise — mirrored by the status query above.
        ...(teamId ? { teamId } : {}),
      }),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['org-budget', org.id] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const period = budget?.period ?? null;
  const consumedPct = period && period.allocatedCredits > 0
    ? Math.min(100, Math.round((period.consumedCredits / period.allocatedCredits) * 100))
    : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-gray-800">Shared Wallet &amp; Budget</span>
        </div>
        <div className="flex items-center gap-3">
          {teams.length > 0 && (
            <select
              aria-label="Budget scope"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white"
            >
              <option value="">Org-wide</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>Team: {t.name}</option>
              ))}
            </select>
          )}
          {canManageBudget(org.role) && !editing && (
            <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:underline">
              New budget period
            </button>
          )}
        </div>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {budget && (
        <div className="grid sm:grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Org balance</p>
            <p className="text-lg font-bold text-gray-900">{budget.orgBalance.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400">credits</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Period budget</p>
            <p className="text-lg font-bold text-gray-900">{period ? period.allocatedCredits.toLocaleString() : '—'}</p>
            <p className="text-[11px] text-gray-400">{period ? (period.hardCap ? 'hard cap' : 'soft cap') : 'no current period'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Remaining</p>
            <p className="text-lg font-bold text-gray-900">{budget.remaining !== null ? budget.remaining.toLocaleString() : '—'}</p>
            <p className="text-[11px] text-gray-400">{period ? `${consumedPct}% consumed` : 'unlimited'}</p>
          </div>
        </div>
      )}

      {period && (
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${consumedPct >= 90 ? 'bg-red-500' : consumedPct >= 70 ? 'bg-amber-400' : 'bg-brand-600'}`}
            style={{ width: `${consumedPct}%` }}
          />
        </div>
      )}

      {editing && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500">
            New period for{' '}
            <span className="font-medium text-gray-700">
              {teamId ? `team "${teams.find((t) => t.id === teamId)?.name ?? teamId}"` : 'the whole organization'}
            </span>
            {' '}— switch the scope picker above to budget a team instead.
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="budget-start" className="block text-xs text-gray-600 mb-1">Period start</label>
              <input id="budget-start" type="date" value={start} onChange={(e) => setStart(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="budget-end" className="block text-xs text-gray-600 mb-1">Period end</label>
              <input id="budget-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="budget-credits" className="block text-xs text-gray-600 mb-1">Allocated credits</label>
              <input id="budget-credits" type="number" min={0} value={allocated} onChange={(e) => setAllocated(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={hardCap} onChange={(e) => setHardCap(e.target.checked)} />
            Hard cap — block spend when the budget is exhausted
          </label>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={!start || !end || save.isPending}
              className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
            >
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save period
            </button>
            <button onClick={() => { setEditing(false); setError(null); }} className="text-sm text-gray-500 hover:text-gray-700 px-3">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Members card ──────────────────────────────────────────────────────────────

function MembersCard({ org }: { org: Org }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [teamId, setTeamId] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: members = [], isLoading } = useQuery<OrgMember[]>({
    queryKey: ['org-members', org.id],
    queryFn: () => api.orgs.members(org.id).then((r) => r.data),
  });
  const { data: teams = [] } = useOrgTeams(org.id);
  const teamName = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? id : '—');

  const add = useMutation({
    mutationFn: () =>
      api.orgs.addMember(org.id, { email: email.trim(), role, approvalRequired, ...(teamId ? { teamId } : {}) }),
    onSuccess: () => {
      setEmail('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['org-members', org.id] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Members</span>
        <span className="text-xs text-gray-400">{members.length}</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {members.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400">
              <th className="py-1.5 font-medium">Member</th>
              <th className="py-1.5 font-medium">Role</th>
              <th className="py-1.5 font-medium">Team</th>
              <th className="py-1.5 font-medium">Spend approval</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-gray-100">
                <td className="py-2 text-gray-800">{m.name || m.email || m.userId}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_BADGE[m.role] ?? ROLE_BADGE['MEMBER']}`}>
                    {m.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-2 text-gray-500 text-xs">{teamName(m.teamId)}</td>
                <td className="py-2 text-gray-500 text-xs">
                  {m.approvalRequired ? (
                    <span className="inline-flex items-center gap-1 text-amber-700"><ShieldCheck className="w-3.5 h-3.5" /> manager approval</span>
                  ) : (
                    'not required'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManageOrg(org.role) && (
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <div className={`grid gap-3 ${teams.length > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <div>
              <label htmlFor="member-email" className="block text-xs text-gray-600 mb-1">Email (must be registered)</label>
              <input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="member-role" className="block text-xs text-gray-600 mb-1">Role</label>
              <select id="member-role" value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="MEMBER">Member</option>
                <option value="TEAM_MANAGER">Team manager</option>
                <option value="BILLING_ADMIN">Billing admin</option>
                <option value="ORG_ADMIN">Org admin</option>
              </select>
            </div>
            {teams.length > 0 && (
              <div>
                <label htmlFor="member-team" className="block text-xs text-gray-600 mb-1">Team</label>
                <select id="member-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
                Require approval for large spends
              </label>
            </div>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>
          )}
          <button
            onClick={() => add.mutate()}
            disabled={!email.trim() || add.isPending}
            className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
          >
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            Add member
          </button>
        </div>
      )}
    </div>
  );
}

// ── Teams card ────────────────────────────────────────────────────────────────

function TeamsCard({ org }: { org: Org }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: teams = [], isLoading } = useOrgTeams(org.id);

  const create = useMutation({
    mutationFn: () => api.orgs.createTeam(org.id, { name: name.trim() }),
    onSuccess: () => {
      setName('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['org-teams', org.id] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Teams</span>
        <span className="text-xs text-gray-400">{teams.length}</span>
      </div>
      <p className="text-xs text-gray-500">
        Teams scope budgets: a budget period created for a team only gates members assigned to it.
      </p>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {teams.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <li key={t.id} className="px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700">{t.name}</li>
          ))}
        </ul>
      )}

      {canManageOrg(org.role) && (
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label htmlFor="team-name" className="block text-xs text-gray-600 mb-1">Team name</label>
              <input id="team-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Video production"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button
              onClick={() => create.mutate()}
              disabled={!name.trim() || create.isPending}
              className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              Create team
            </button>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Usage report card ─────────────────────────────────────────────────────────

function UsageReportCard({ org }: { org: Org }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canViewReports(org.role)) return null;

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      // Authenticated download via the api client (a plain <a href> would miss the JWT)
      const res = await apiClient.get(api.orgs.usageReportCsvUrl(org.id), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `org-usage-${org.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-800">Usage report</p>
        <p className="text-xs text-gray-500">Per-member credit usage rollup for this organization.</p>
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>
        )}
      </div>
      <button
        onClick={() => void download()}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg px-4 py-2"
      >
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Download CSV
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrgsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: orgs = [], isLoading } = useQuery<Org[]>({
    queryKey: ['orgs-mine'],
    queryFn: () => api.orgs.mine().then((r) => r.data),
  });

  const selected = orgs.find((o) => o.id === selectedId) ?? orgs[0] ?? null;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Building2 className="w-6 h-6 text-brand-600" /> Organization
        </h1>
        <p className="text-gray-500 mt-1">
          Shared wallets, budgets and member roles. Projects and copilot turns can bill here instead of your personal wallet.
        </p>
      </div>

      {isLoading && <Loader2 className="w-6 h-6 animate-spin text-brand-600" />}

      {!isLoading && orgs.length > 1 && (
        <div>
          <label htmlFor="org-select" className="block text-xs text-gray-600 mb-1">Organization</label>
          <select
            id="org-select"
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_BADGE[selected.role] ?? ROLE_BADGE['MEMBER']}`}>
              your role: {selected.role.replace(/_/g, ' ')}
            </span>
          </div>
          <BudgetCard org={selected} />
          <TeamsCard org={selected} />
          <MembersCard org={selected} />
          <UsageReportCard org={selected} />
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{orgs.length === 0 ? 'Get started' : 'New organization'}</h2>
        <CreateOrgCard onCreated={(org) => setSelectedId(org.id)} />
      </section>
    </div>
  );
}
