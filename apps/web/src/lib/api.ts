import axios from 'axios';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1';

export const apiClient = axios.create({ baseURL: BASE, withCredentials: true });

// ── Token storage helpers ────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cf_token');
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cf.refreshToken');
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem('cf_token', accessToken);
  localStorage.setItem('cf.refreshToken', refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem('cf_token');
  localStorage.removeItem('cf.refreshToken');
}

// ── Single-flight refresh guard ──────────────────────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${BASE}/auth/refresh`,
        { refreshToken },
      );
      setTokens(res.data.accessToken, res.data.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Request interceptor: attach access token ─────────────────────────────────

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getAccessToken();
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: 401 → refresh → retry (once) ──────────────────────

apiClient.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (typeof window === 'undefined') return Promise.reject(err);

    // Only credential-exchange endpoints are excluded — a 401 there means bad
    // credentials, not an expired access token. Authed reads like /auth/me,
    // /auth/sessions, /auth/links still go through the refresh-retry path.
    const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh'];
    const isAuthEndpoint =
      typeof err.config?.url === 'string' &&
      (NO_REFRESH.some((p) => err.config.url.startsWith(p)) ||
        /^\/auth\/[^/]+\/(start|callback)/.test(err.config.url));

    if (err.response?.status === 401 && !isAuthEndpoint && !err.config?._retried) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        // Patch the failed request with the new token and retry once
        // @reason: axios InternalAxiosRequestConfig has no index signature; casting needed to add _retried sentinel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryConfig = { ...err.config, _retried: true } as any;
        retryConfig.headers = {
          ...retryConfig.headers,
          Authorization: `Bearer ${getAccessToken()}`,
        };
        return apiClient.request(retryConfig);
      }
      // Refresh failed — send to login
      window.location.href = '/login';
    }

    return Promise.reject(err);
  },
);

// ── Library types ─────────────────────────────────────────────────────────────

export interface LibraryVideo {
  id: string;
  youtubeVideoId: string;
  kind: 'video' | 'short';
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  durationMs: number;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface LibraryPlaylist {
  id: string;
  youtubePlaylistId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  itemCount: number;
}

export interface LibraryPlaylistItem {
  id: string;
  position: number;
  video: LibraryVideo;
}

export interface LibraryVideosPage {
  data: LibraryVideo[];
  nextCursor: string | null;
}

export interface LibraryPlaylistsPage {
  data: LibraryPlaylist[];
  nextCursor: string | null;
}

export interface LibraryPlaylistItemsPage {
  data: LibraryPlaylistItem[];
  nextCursor: string | null;
}

export type LibrarySyncPhase = 'IDLE' | 'VIDEOS' | 'PLAYLISTS' | 'PLAYLIST_ITEMS' | 'DONE' | 'ERROR';

export interface LibrarySyncStatus {
  phase: LibrarySyncPhase;
  syncedVideos: number;
  syncedPlaylists: number;
  error?: string | null;
  startedAt?: string;
  completedAt?: string;
}

export interface LibrarySyncStartResponse {
  jobId: string;
}

// ── Wallet types ──────────────────────────────────────────────────────────────

export type BudgetStatus = 'NONE' | 'OK' | 'ALERT' | 'EXCEEDED';

export interface BudgetState {
  status: BudgetStatus;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  willExceed: boolean;
  blocked: boolean;
  alertThreshold: number;
  hardCap: boolean;
}

export interface UsageSummary {
  totalSpent: number;
  byAction: Array<{ action: string; credits: number }>;
}

export interface CreditLotRow {
  id: string;
  bucket: string;
  amount: number;
  remaining: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreditPackRow {
  id: string;
  name: string;
  credits: number;
  priceMinor: number;
  currency: string;
  region: string | null;
  sortOrder: number;
}

export interface CreditForecast {
  windowDays: number;
  totalDebited: number;
  dailyBurn: number;
  balance: number;
  daysToEmpty: number | null;
  emptyOn: string | null;
  projectedMonthEndSpend: number;
}

export interface CreditRecommendation {
  type: string;
  severity: 'info' | 'warning';
  message: string;
  meta?: Record<string, unknown>;
}

export interface WalletTransaction {
  id: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

// ── Organization types (Phase 5 §10) ──────────────────────────────────────────

export interface Org {
  id: string;
  name: string;
  ownerUserId: string;
  billingEmail: string | null;
  status: string;
  /** The caller's role in this org (ORG_ADMIN | TEAM_MANAGER | BILLING_ADMIN | MEMBER). */
  role: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  teamId: string | null;
  role: string;
  approvalRequired: boolean;
  email: string | null;
  name: string | null;
}

export interface OrgTeam {
  id: string;
  name: string;
  ownerId: string;
  orgId: string;
  createdAt: string;
}

export interface OrgBudgetStatus {
  period: {
    id: string;
    periodStart: string;
    periodEnd: string;
    allocatedCredits: number;
    consumedCredits: number;
    hardCap: boolean;
  } | null;
  remaining: number | null;
  orgBalance: number;
}

// ── Trial types ───────────────────────────────────────────────────────────────

export type TrialStatus = 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'REVOKED' | 'PENDING_REVIEW';

export interface TrialStatusResponse {
  hasTrial: boolean;
  status?: TrialStatus;
  creditsGranted?: number;
  trialCreditsRemaining?: number;
  grantedAt?: string;
  expiresAt?: string;
}

export interface TrialLimitsResponse {
  isTrialUser: boolean;
  limits: Array<{ id: string; feature: string; access: 'enabled' | 'limited' | 'disabled'; limitValue: number | null }>;
}

// ── Offer types ───────────────────────────────────────────────────────────────

export interface Offer {
  id: string;
  type: string;
  name: string;
  rewardType: string;
  rewardValue: number;
  minRechargeMinor: number | null;
  validTo: string | null;
  redeemable: boolean;
}

// ── Upgrade types ─────────────────────────────────────────────────────────────

export interface UpgradeRecommendation {
  id: string;
  reasonCode: string;
  recommendedPlan: string;
  confidence: number;
  createdAt: string;
}

// ── Referral types ────────────────────────────────────────────────────────────

export interface ReferralEntry {
  id: string;
  status: 'PENDING' | 'QUALIFIED' | 'REWARDED' | 'FLAGGED';
  reward: number;
  createdAt: string;
}

export interface ReferralEarnings {
  code: string;
  totalCredits: number;
  qualifiedCount: number;
  pendingCount: number;
  flaggedCount: number;
  referrals: ReferralEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  userLabel: string;
  qualifiedCount: number;
  totalCredits: number;
}

// ── Notification types ────────────────────────────────────────────────────────

export type NotificationType =
  | 'trial.expiring'
  | 'trial.exhausted'
  | 'trial.expired'
  | 'credits.low'
  | 'offer.available'
  | 'referral.reward'
  | 'bonus.granted'
  | 'recharge.success';

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  meta: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: AppNotification[];
  unreadCount: number;
  /** Keyset cursor for the next page; null when this is the last page. */
  nextCursor: string | null;
}

// ── Auth provider types ───────────────────────────────────────────────────────

export interface OAuthProviders {
  google: boolean;
  apple: boolean;
  facebook: boolean;
}

export type OAuthProvider = 'google' | 'apple' | 'facebook';

export interface OAuthStartResponse {
  authUrl: string;
  state: string;
}

export interface OAuthCallbackResponse {
  accessToken?: string;
  refreshToken?: string;
  linked?: true;
  provider?: OAuthProvider;
}

export interface LinkedAccount {
  provider: OAuthProvider;
  email: string;
  linkedAt: string;
}

export interface AuthLinksResponse {
  password: boolean;
  links: LinkedAccount[];
}

export interface AuthSession {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

// ── Automation types ──────────────────────────────────────────────────────────

export interface ChannelAutomation {
  enabled: boolean;
  autoImport: boolean;
  autoAnalyze: boolean;
  autoPublish: boolean;
  chapterSyncEnabled: boolean;
  publishIntervalMinutes: number;
  maxPublishesPerDay: number;
  maxImportsPerDay: number;
  aiSuggestion?: object | null;
  lastTickAt?: string | null;
}

export interface AutomationSuggestion {
  suggestion: Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'>;
  source: 'ai' | 'heuristic';
}

// ── Autonomy (Phase 6): channel profile + AI content calendar ────────────────

export type CalendarEntryStatus = 'PROPOSED' | 'APPROVED' | 'DISMISSED' | 'SCHEDULED';
export type CalendarFormat = 'VIDEO' | 'SHORT';

export interface CalendarEntry {
  id: string;
  channelId: string;
  batchId: string;
  title: string;
  angle: string | null;
  format: CalendarFormat;
  plannedAt: string;
  priority: number;
  keywords: string[];
  rationale: string | null;
  source: string;
  status: CalendarEntryStatus;
  videoId: string | null;
  createdAt: string;
}

export interface ChannelProfileData {
  niche: string;
  subscriberCount: number;
  totalUploads: number;
  uploadsPerWeek90d: number;
  avgViews90d: number;
  bestWeekdays: string[];
  bestHourUtc: number;
  formatMix: { videos: number; shorts: number };
  topTitles: string[];
  pipeline: Record<string, number>;
}

export interface ChannelProfileRow {
  id: string;
  channelId: string;
  profile: ChannelProfileData;
  computedAt: string;
}

export interface GenerateCalendarResult {
  batchId: string | null;
  source: 'ai' | 'heuristic';
  dryRun: boolean;
  profile: ChannelProfileData;
  entries: Array<Omit<CalendarEntry, 'id' | 'status' | 'createdAt'> & Partial<Pick<CalendarEntry, 'id' | 'status' | 'createdAt'>>>;
}

// ── Scheduler / publish tracking ─────────────────────────────────────────────

export type TrackedVideoStatus = 'SCHEDULED' | 'PUBLISHED' | 'FAILED';

export interface TrackedVideo {
  id: string;
  title: string;
  status: TrackedVideoStatus;
  youtubeVideoId: string | null;
  thumbnailUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  channel: { id: string; title: string };
  project: { id: string; title: string };
}

export interface TrackedVideosPage {
  data: TrackedVideo[];
  total: number;
  take: number;
  skip: number;
}

export interface PublishTrackingSummary {
  scheduled: number;
  upcoming7d: number;
  published: number;
  publishedThisMonth: number;
  failed: number;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      apiClient.post<{ accessToken: string; refreshToken: string; user: { id: string; email: string; name: string } }>('/auth/login', { email, password }),
    register: (email: string, password: string, name?: string) =>
      apiClient.post<{ accessToken: string; refreshToken: string; user: { id: string; email: string; name: string } }>('/auth/register', { email, password, name }),
    me: () =>
      apiClient.get<{ id: string; email: string; name: string; role: string }>('/auth/me'),
    // OAuth / social auth
    providers: () =>
      apiClient.get<OAuthProviders>('/auth/providers'),
    oauthStart: (provider: OAuthProvider, redirectUri: string, mode?: 'login' | 'link') =>
      apiClient.post<OAuthStartResponse>(`/auth/${provider}/start`, { redirectUri, ...(mode ? { mode } : {}) }),
    oauthCallback: (provider: OAuthProvider, code: string, state: string) =>
      apiClient.post<OAuthCallbackResponse>(`/auth/${provider}/callback`, { code, state }),
    refresh: (refreshToken: string) =>
      apiClient.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }),
    logout: (refreshToken?: string) =>
      apiClient.post('/auth/logout', refreshToken ? { refreshToken } : {}),
    // Session management
    sessions: () =>
      apiClient.get<AuthSession[]>('/auth/sessions'),
    revokeSession: (id: string) =>
      apiClient.delete(`/auth/sessions/${id}`),
    // Linked account management
    links: () =>
      apiClient.get<AuthLinksResponse>('/auth/links'),
    unlinkProvider: (provider: OAuthProvider) =>
      apiClient.delete(`/auth/link/${provider}`),
  },
  channels: {
    list: () => apiClient.get('/channels'),
    status: () => apiClient.get('/channels/status'),
    getAuthUrl: (redirectUri: string, access?: 'READ_ONLY' | 'PUBLISH' | 'FULL') =>
      apiClient.get(`/channels/auth-url?redirectUri=${encodeURIComponent(redirectUri)}${access ? `&access=${access}` : ''}`),
    connectByUrl: (channelUrl: string) => apiClient.post('/channels/connect-by-url', { channelUrl }),
    disconnect: (id: string) => apiClient.delete(`/channels/${id}`),
    remove: (id: string) => apiClient.post(`/channels/${id}/remove`),
    refresh: (channelId: string) => apiClient.post('/channels/refresh', { channelId }),
  },
  projects: {
    list: (opts?: { cursor?: string; limit?: number }) => {
      const sp = new URLSearchParams();
      if (opts?.cursor) sp.set('cursor', opts.cursor);
      if (opts?.limit !== undefined) sp.set('limit', String(opts.limit));
      const qs = sp.toString();
      return apiClient.get(`/projects${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => apiClient.get(`/projects/${id}`),
    create: (data: { channelId: string; title: string; niche?: string; targetLang?: string }) =>
      apiClient.post('/projects', data),
    update: (id: string, data: Record<string, unknown>) => apiClient.put(`/projects/${id}`, data),
    delete: (id: string) => apiClient.delete(`/projects/${id}`),
  },
  jobs: {
    enqueue: (projectId: string, type: string, payload?: Record<string, unknown>) =>
      apiClient.post('/jobs', { projectId, type, ...(payload ? { payload } : {}) }),
    get: (id: string) => apiClient.get(`/jobs/${id}`),
    listByProject: (projectId: string) => apiClient.get(`/jobs/project/${projectId}`),
    cancel: (id: string) => apiClient.delete(`/jobs/${id}`),
    remove: (id: string) => apiClient.delete(`/jobs/${id}/record`),
    overrideResult: (projectId: string, type: string, result: Record<string, unknown>) =>
      apiClient.patch(`/jobs/project/${projectId}/override/${type}`, { result }),
  },
  approvals: {
    listPending: (cursor?: string) =>
      apiClient.get(`/approvals/pending${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    listHistory: (cursor?: string) =>
      apiClient.get(`/approvals/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    approve: (id: string, notes?: string) => apiClient.post(`/approvals/${id}/approve`, { notes }),
    reject: (id: string, notes?: string) => apiClient.post(`/approvals/${id}/reject`, { notes }),
    moveToEditing: (id: string, notes?: string) => apiClient.post(`/approvals/${id}/move-to-editing`, { notes }),
  },
  trends: {
    analyze: (niche: string) => apiClient.post('/trends/analyze', { niche }),
  },
  billing: {
    getSubscription: () => apiClient.get('/billing/subscription'),
    createCheckout: (plan: string) =>
      apiClient.post('/billing/checkout', {
        plan,
        successUrl: `${window.location.origin}/wallet?upgraded=true`,
        cancelUrl: `${window.location.origin}/wallet`,
      }),
  },
  wallet: {
    balance: () => apiClient.get('/wallet/balance'),
    transactions: (take = 20) => apiClient.get(`/wallet/transactions?take=${take}`),
    lots: () => apiClient.get<CreditLotRow[]>('/wallet/lots'),
    recharge: (amountUsd: number) =>
      apiClient.post('/wallet/recharge', {
        amountUsd,
        successUrl: `${window.location.origin}/wallet?recharged=true`,
        cancelUrl: `${window.location.origin}/wallet`,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    rechargePack: (packId: string) =>
      apiClient.post('/wallet/recharge', {
        packId,
        successUrl: `${window.location.origin}/wallet?recharged=true`,
        cancelUrl: `${window.location.origin}/wallet`,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    budget: {
      get: () => apiClient.get<BudgetState>('/wallet/budget'),
      set: (data: { monthlyLimit: number; alertThreshold?: number; hardCap?: boolean }) =>
        apiClient.put<BudgetState>('/wallet/budget', data),
    },
    usageSummary: (days = 30) =>
      apiClient.get<UsageSummary>(`/wallet/usage-summary?days=${days}`),
    forecast: (days = 30) =>
      apiClient.get<CreditForecast>(`/wallet/forecast?days=${days}`),
    recommendations: () =>
      apiClient.get<CreditRecommendation[]>('/wallet/recommendations'),
  },
  marketplace: {
    packs: (region?: string) =>
      apiClient.get<CreditPackRow[]>(`/marketplace/packs${region ? `?region=${encodeURIComponent(region)}` : ''}`),
  },
  orgs: {
    mine: () => apiClient.get<Org[]>('/orgs/mine'),
    create: (data: { name: string; billingEmail?: string }) =>
      apiClient.post<Org>('/orgs', data),
    members: (orgId: string) => apiClient.get<OrgMember[]>(`/orgs/${orgId}/members`),
    addMember: (orgId: string, data: { email: string; role?: string; approvalRequired?: boolean; teamId?: string }) =>
      apiClient.post<OrgMember>(`/orgs/${orgId}/members`, data),
    teams: (orgId: string) => apiClient.get<OrgTeam[]>(`/orgs/${orgId}/teams`),
    createTeam: (orgId: string, data: { name: string }) =>
      apiClient.post<OrgTeam>(`/orgs/${orgId}/teams`, data),
    budget: (orgId: string, teamId?: string) =>
      apiClient.get<OrgBudgetStatus>(`/orgs/${orgId}/budget${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`),
    setBudget: (orgId: string, data: { periodStart: string; periodEnd: string; allocatedCredits: number; hardCap?: boolean; teamId?: string }) =>
      apiClient.put(`/orgs/${orgId}/budget`, data),
    usageReportCsvUrl: (orgId: string) => `/orgs/${orgId}/reports/usage?format=csv`,
    usageReport: (orgId: string, params?: { from?: string; to?: string; teamId?: string }) =>
      apiClient.get(`/orgs/${orgId}/reports/usage`, { params }),
  },
  media: {
    listExports: (projectId: string) =>
      apiClient.get<Array<{ name: string; sizeBytes: number }>>(`/media/exports/${projectId}`),
    downloadExport: (projectId: string, fileName: string) =>
      apiClient.get(`/media/exports/${projectId}/${encodeURIComponent(fileName)}`, { responseType: 'blob' }),
    versionFile: (versionId: string) =>
      apiClient.get(`/media/versions/${versionId}/file`, { responseType: 'blob' }),
    versionSignedUrl: (versionId: string, ttl?: number) =>
      apiClient.get<{ url: string; expiresAt: string }>(
        `/media/versions/${versionId}/signed-url${ttl ? `?ttl=${ttl}` : ''}`,
      ),
  },
  settings: {
    getApiKeys: () =>
      apiClient.get<Array<{ key: string; label: string; masked: string; set: boolean }>>('/settings/api-keys'),
    updateApiKeys: (keys: Record<string, string>) =>
      apiClient.put('/settings/api-keys', keys),
  },
  shortsStudio: {
    importVideo: (channelId: string, youtubeVideoId: string) =>
      apiClient.post('/shorts-studio/videos/import', { channelId, youtubeVideoId }),
    listImported: (channelId: string) =>
      apiClient.get(`/shorts-studio/channels/${channelId}/imported`),
    deleteImported: (importedVideoId: string) =>
      apiClient.delete(`/shorts-studio/videos/${importedVideoId}`),
    updateNotes: (importedVideoId: string, notes: string) =>
      apiClient.patch(`/shorts-studio/videos/${importedVideoId}/notes`, { notes }),
    analyze: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/analyze`),
    analysisStatus: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/analysis-status`),
    transcript: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/transcript`),
    scenes: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/scenes`),
    topics: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/topics`),
    highlights: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/highlights`),
    renderQuoteCard: (socialContentId: string) =>
      apiClient.post(`/shorts-studio/social-content/${socialContentId}/render-quote-card`),
    mediaVersionFile: (versionId: string) =>
      apiClient.get(`/media/versions/${versionId}/file`, { responseType: 'blob' }),
    socialContent: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/social-content`),
    generateSocialContent: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/social-content`),
    syncChapters: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/sync-chapters`),
    generateChurchPack: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/church-pack`),
    generateSmallVideos: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/small-videos`),
    searchVideo: (importedVideoId: string, q: string, limit = 10) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    generateEmbeddings: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/generate-embeddings`),
    chapters: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/chapters`),
    detectChapters: (importedVideoId: string) =>
      apiClient.post(`/shorts-studio/videos/${importedVideoId}/detect-chapters`),
    updateChapter: (chapterId: string, patch: { title?: string; summary?: string }) =>
      apiClient.patch(`/shorts-studio/chapters/${chapterId}`, patch),
    recommendations: (importedVideoId: string, limit = 10) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/recommendations?limit=${limit}`),
    generateClips: (highlightId: string, clipTypes: string[]) =>
      apiClient.post(`/shorts-studio/highlights/${highlightId}/generate-clips`, { clipTypes }),
    listClips: (projectId: string) =>
      apiClient.get(`/shorts-studio/projects/${projectId}/clips`),
    clipTimeline: (shortClipId: string) =>
      apiClient.get(`/shorts-studio/clips/${shortClipId}/timeline`),
    applyCommands: (timelineId: string, commands: unknown[]) =>
      apiClient.patch(`/shorts-studio/timelines/${timelineId}`, { commands }),
    aiSuggest: (timelineId: string, capability: string) =>
      apiClient.post(`/shorts-studio/timelines/${timelineId}/ai-suggestions`, { capability }),
    aiApply: (timelineId: string, commands: unknown[]) =>
      apiClient.post(`/shorts-studio/timelines/${timelineId}/ai-suggestions/apply`, { commands }),
    timelineHistory: (timelineId: string) =>
      apiClient.get(`/shorts-studio/timelines/${timelineId}/history`),
    generateCaptions: (shortClipId: string) =>
      apiClient.post(`/shorts-studio/clips/${shortClipId}/captions`),
    videoClips: (importedVideoId: string) =>
      apiClient.get(`/shorts-studio/videos/${importedVideoId}/clips`),
    render: (shortClipId: string) =>
      apiClient.post(`/shorts-studio/clips/${shortClipId}/render`),
    renderStatus: (shortClipId: string) =>
      apiClient.get(`/shorts-studio/clips/${shortClipId}/render-status`),
    thumbnails: (shortClipId: string) =>
      apiClient.get(`/shorts-studio/clips/${shortClipId}/thumbnails`),
    setPrimaryThumbnail: (thumbnailId: string) =>
      apiClient.post(`/shorts-studio/thumbnails/${thumbnailId}/set-primary`),
    exportClip: (shortClipId: string) =>
      apiClient.post(`/shorts-studio/clips/${shortClipId}/export`),
    requestPublish: (shortClipId: string) =>
      apiClient.post(`/shorts-studio/clips/${shortClipId}/request-publish`),
    publish: (shortClipId: string) =>
      apiClient.post(`/shorts-studio/clips/${shortClipId}/publish`),
    publishStatus: (shortClipId: string) =>
      apiClient.get(`/shorts-studio/clips/${shortClipId}/publish-status`),
  },
  library: {
    syncStart: (channelId: string) =>
      apiClient.post<LibrarySyncStartResponse>(`/channels/${channelId}/sync`),
    syncStatus: (channelId: string) =>
      apiClient.get<LibrarySyncStatus>(`/channels/${channelId}/sync-status`),
    listVideos: (
      channelId: string,
      params: { cursor?: string; q?: string; type?: string; sort?: string },
    ) => {
      const sp = new URLSearchParams();
      if (params.cursor) sp.set('cursor', params.cursor);
      if (params.q) sp.set('q', params.q);
      if (params.type) sp.set('type', params.type);
      if (params.sort) sp.set('sort', params.sort);
      const qs = sp.toString();
      return apiClient.get<LibraryVideosPage>(`/channels/${channelId}/videos${qs ? `?${qs}` : ''}`);
    },
    listPlaylists: (channelId: string, cursor?: string) =>
      apiClient.get<LibraryPlaylistsPage>(
        `/channels/${channelId}/playlists${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    listPlaylistItems: (channelId: string, playlistId: string, cursor?: string) =>
      apiClient.get<LibraryPlaylistItemsPage>(
        `/channels/${channelId}/playlists/${playlistId}/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    reorderPlaylist: (channelId: string, playlistId: string, itemIds: string[]) =>
      apiClient.patch(`/channels/${channelId}/playlists/${playlistId}/order`, { itemIds }),
  },
  autonomy: {
    profile: (channelId: string, refresh = false) =>
      apiClient.get<ChannelProfileRow>(`/autonomy/channels/${channelId}/profile${refresh ? '?refresh=true' : ''}`),
    generateCalendar: (channelId: string, body?: { weeks?: number; perWeek?: number; dryRun?: boolean }) =>
      apiClient.post<GenerateCalendarResult>(`/autonomy/channels/${channelId}/calendar/generate`, body ?? {}),
    listCalendar: (channelId: string, params?: { status?: CalendarEntryStatus; from?: string; to?: string }) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      const qs = sp.toString();
      return apiClient.get<CalendarEntry[]>(`/autonomy/channels/${channelId}/calendar${qs ? `?${qs}` : ''}`);
    },
    approveEntry: (entryId: string) =>
      apiClient.post<CalendarEntry>(`/autonomy/calendar/${entryId}/approve`),
    dismissEntry: (entryId: string) =>
      apiClient.post<CalendarEntry>(`/autonomy/calendar/${entryId}/dismiss`),
  },
  publishing: {
    listVideos: (params?: {
      channelId?: string;
      status?: TrackedVideoStatus[];
      from?: string;
      to?: string;
      q?: string;
      take?: number;
      skip?: number;
    }) => {
      const sp = new URLSearchParams();
      if (params?.channelId) sp.set('channelId', params.channelId);
      if (params?.status?.length) sp.set('status', params.status.join(','));
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      if (params?.q) sp.set('q', params.q);
      if (params?.take !== undefined) sp.set('take', String(params.take));
      if (params?.skip !== undefined) sp.set('skip', String(params.skip));
      const qs = sp.toString();
      return apiClient.get<TrackedVideosPage>(`/publishing/videos${qs ? `?${qs}` : ''}`);
    },
    summary: (channelId?: string) =>
      apiClient.get<PublishTrackingSummary>(
        `/publishing/videos/summary${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`,
      ),
  },
  trial: {
    status: () => apiClient.get<TrialStatusResponse>('/trial/status'),
    limits: () => apiClient.get<TrialLimitsResponse>('/trial/limits'),
  },
  offers: {
    mine: () => apiClient.get<Offer[]>('/offers'),
    redeem: (id: string) => apiClient.post<{ redeemed: boolean; credits: number }>(`/offers/${id}/redeem`),
  },
  upgrade: {
    recommendations: () => apiClient.get<UpgradeRecommendation[]>('/upgrade/recommendations'),
    dismiss: (id: string) => apiClient.post<{ dismissed: boolean }>(`/upgrade/recommendations/${id}/dismiss`),
  },
  referral: {
    code: () => apiClient.post<{ code: string }>('/referral/code'),
    redeem: (code: string) => apiClient.post<{ ok?: boolean }>('/referral/redeem', { code }),
    earnings: () => apiClient.get<ReferralEarnings>('/referral/earnings'),
    leaderboard: () => apiClient.get<LeaderboardEntry[]>('/referral/leaderboard'),
  },
  notifications: {
    list: (opts?: { unreadOnly?: boolean; take?: number; cursor?: string }) => {
      const sp = new URLSearchParams();
      if (opts?.unreadOnly) sp.set('unreadOnly', 'true');
      if (opts?.take !== undefined) sp.set('take', String(opts.take));
      if (opts?.cursor) sp.set('cursor', opts.cursor);
      const qs = sp.toString();
      return apiClient.get<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ''}`);
    },
    markRead: (id: string) =>
      apiClient.post(`/notifications/${id}/read`),
    markAllRead: () =>
      apiClient.post('/notifications/read-all'),
  },
  admin: {
    enterpriseMetrics: () => apiClient.get<EnterpriseMetrics>('/admin/analytics/enterprise'),
    forecasts: (metric?: string) =>
      apiClient.get<ForecastRow[]>(`/admin/forecasts${metric ? `?metric=${encodeURIComponent(metric)}` : ''}`),
    generateForecasts: () => apiClient.post<{ ok: boolean; message: string }>('/admin/forecasts/generate'),
    providers: () => apiClient.get<AdminProvider[]>('/admin/providers'),
  },
  automation: {
    get: (channelId: string) =>
      apiClient.get<ChannelAutomation>(`/channels/${channelId}/automation`),
    update: (channelId: string, data: Partial<Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'>>) =>
      apiClient.put<ChannelAutomation>(`/channels/${channelId}/automation`, data),
    suggest: (channelId: string) =>
      apiClient.post<AutomationSuggestion>(`/channels/${channelId}/automation/suggest`),
  },
  editor: {
    create: (projectId: string, body: {
      sourceKind?: 'VIDEO' | 'IMPORTED_VIDEO' | 'ASSET';
      sourceId?: string;
      title?: string;
      width?: number;
      height?: number;
      fps?: number;
    }) =>
      apiClient.post<EditProject>(`/editor/projects/${projectId}`, body),
    /** All edits the current user owns (channel-first — no projectId needed). */
    listMine: () => apiClient.get<EditProject[]>(`/editor/mine`),
    /** Blank edit; the container project is resolved server-side. */
    createBlank: (body: { title?: string; width?: number; height?: number; fps?: number }) =>
      apiClient.post<EditProject>(`/editor/blank`, body),
    /** Open an imported video; projectId resolved from the video server-side. */
    createFromImported: (importedVideoId: string, title?: string) =>
      apiClient.post<EditProject>(`/editor/from-imported/${importedVideoId}`, { title }),
    get: (editId: string) =>
      apiClient.get<EditProject>(`/editor/${editId}`),
    listByProject: (projectId: string) =>
      apiClient.get<EditProject[]>(`/editor/projects/${projectId}`),
    saveTimeline: (editId: string, timeline: EditTimeline) =>
      apiClient.put<EditProject>(`/editor/${editId}/timeline`, timeline),
    mediaBin: (editId: string) =>
      apiClient.get<MediaBinEntry[]>(`/editor/${editId}/media-bin`),
    render: (editId: string, options: RenderPreset | EditExportOptions) =>
      apiClient.post<{ renderStatus: RenderStatus }>(
        `/editor/${editId}/render`,
        // Back-compat: a plain string becomes { preset }; an options object is passed as-is.
        typeof options === 'string' ? { preset: options } : options,
      ),
    renderStatus: (editId: string) =>
      apiClient.get<{ renderStatus: RenderStatus; renderAssetId?: string | null; downloadPath?: string }>(`/editor/${editId}/render-status`),
  },
};

// ── Enterprise admin dashboard (Phase 5 §9) ──────────────────────────────────

export interface EnterpriseMetrics {
  /**
   * North-star metric (docs4/01): published, human-approved videos produced
   * through the full workflow per active channel, trailing 30 days.
   */
  northStar: {
    publishedVideos30d: number;
    activeChannels30d: number;
    perActiveChannel: number;
  };
  /** Minor units (cents). */
  mrr: number;
  /** Minor units (cents). */
  arr: number;
  /** Last 6 × 30-day buckets, oldest first, minor units. */
  revenueByMonth: number[];
  arpu: number;
  ltv: number;
  /** 0..1 fraction. */
  churn: number;
  aiCostUsd: number;
  cacheSavingsUsd: number;
  topModels: Array<{ model: string; costUsd: number; tokensIn: number; tokensOut: number }>;
}

export interface ForecastRow {
  id: string;
  metric: string;
  horizonDays: number;
  predictedValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  method: string;
  inputPointsCount: number;
  generatedAt: string;
}

export interface AdminProvider {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DEGRADED' | 'DISABLED' | string;
  priority: number;
  qualityScore: number;
  failureRate: number;
  avgHealthScore: number;
  costRates: Array<{ unit: string; inputCost: number; outputCost: number }>;
  healthEvents: Array<{ event: string; checkedAt: string }>;
}

// ── Editor types ──────────────────────────────────────────────────────────────

export interface EditItemFilters {
  brightness?: number;   // -1..1
  contrast?: number;     // 0..2
  saturation?: number;   // 0..3
  grayscale?: boolean;
  blur?: number;         // 0..20
}

export type TransitionType = 'fade' | 'dissolve' | 'slide';

export interface EditItemTransition {
  type: TransitionType;
  durationMs: number;   // 100..3000
}

export type TextAnimType = 'none' | 'fade-in' | 'slide-up';

export interface EditKeyframe {
  atMs: number;
  opacity?: number;
  scale?: number;
  x?: number;
  y?: number;
}

export interface EditItemProperties {
  volume?: number;
  speed?: number;
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  // Phase 2 — all optional; Phase-1 items without these still work
  filters?: EditItemFilters;
  transitionIn?: EditItemTransition;
  textAnim?: TextAnimType;
  keyframes?: EditKeyframe[];
  // Phase 3 audio controls — all optional; VIDEO and AUDIO items only
  fadeInMs?: number;     // 0..10000
  fadeOutMs?: number;    // 0..10000
  gainDb?: number;       // -60..12  (0 = unity)
  duckUnderVoice?: boolean; // AUDIO items: duck this track when voice is detected
}

export interface EditItem {
  id: string;
  sourceAssetId?: string;
  kind: 'VIDEO' | 'IMAGE' | 'AUDIO' | 'TEXT';
  timelineStartMs: number;
  timelineEndMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  properties?: EditItemProperties;
}

export interface EditTrack {
  id: string;
  kind: 'VIDEO' | 'AUDIO' | 'TEXT';
  label: string;
  items: EditItem[];
}

export interface EditTimeline {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  tracks: EditTrack[];
}

export type RenderPreset = '1080P_16_9' | '1080P_9_16' | '720P_16_9' | '1080P_1_1' | 'SOURCE';
export type RenderStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
export type RenderFormat = 'mp4' | 'webm';
export type RenderQuality = 'draft' | 'standard' | 'high';

/** Phase 3: extended export options; a bare RenderPreset string is still accepted. */
export interface EditExportOptions {
  preset: RenderPreset;
  format?: RenderFormat;
  quality?: RenderQuality;
}

export type EditProjectStatus = 'DRAFT' | 'RENDERING' | 'READY' | 'FAILED';

export interface EditProject {
  id: string;
  projectId: string;
  title: string;
  status: EditProjectStatus;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  timeline: EditTimeline;
  renderAssetId?: string | null;
  renderStatus?: RenderStatus | null;
  lastEditedAt: string;
}

export interface MediaBinEntry {
  id: string;
  /** Asset kinds from the API: VIDEO, IMAGE, VOICE, MUSIC, RENDER_SOURCE, EDIT_RENDER, SHORTS_SOURCE_VIDEO. */
  kind: string;
  label: string;
  durationMs: number | null;
  /** Server-side storage path — NOT loadable by the browser; use versionId + signed URL instead. */
  previewPath: string | null;
  versionId: string | null;
}
