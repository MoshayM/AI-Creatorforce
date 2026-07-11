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
    list: () => apiClient.get('/projects'),
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
    listPending: () => apiClient.get('/approvals/pending'),
    listHistory: () => apiClient.get('/approvals/history'),
    approve: (id: string, notes?: string) => apiClient.post(`/approvals/${id}/approve`, { notes }),
    reject: (id: string, notes?: string) => apiClient.post(`/approvals/${id}/reject`, { notes }),
  },
  trends: {
    analyze: (niche: string) => apiClient.post('/trends/analyze', { niche }),
  },
  billing: {
    getSubscription: () => apiClient.get('/billing/subscription'),
    createCheckout: (plan: string) =>
      apiClient.post('/billing/checkout', {
        plan,
        successUrl: `${window.location.origin}/settings?upgraded=true`,
        cancelUrl: `${window.location.origin}/settings`,
      }),
  },
  wallet: {
    balance: () => apiClient.get('/wallet/balance'),
    transactions: (take = 20) => apiClient.get(`/wallet/transactions?take=${take}`),
    recharge: (amountUsd: number) =>
      apiClient.post('/wallet/recharge', {
        amountUsd,
        successUrl: `${window.location.origin}/settings?recharged=true`,
        cancelUrl: `${window.location.origin}/settings`,
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  },
  media: {
    listExports: (projectId: string) =>
      apiClient.get<Array<{ name: string; sizeBytes: number }>>(`/media/exports/${projectId}`),
    downloadExport: (projectId: string, fileName: string) =>
      apiClient.get(`/media/exports/${projectId}/${encodeURIComponent(fileName)}`, { responseType: 'blob' }),
    versionFile: (versionId: string) =>
      apiClient.get(`/media/versions/${versionId}/file`, { responseType: 'blob' }),
  },
  settings: {
    getApiKeys: () =>
      apiClient.get<Array<{ key: string; label: string; masked: string; set: boolean }>>('/settings/api-keys'),
    updateApiKeys: (keys: Record<string, string>) =>
      apiClient.put('/settings/api-keys', keys),
  },
  shortsStudio: {
    listChannelVideos: (channelId: string, pageToken?: string) =>
      apiClient.get(`/shorts-studio/channels/${channelId}/videos${pageToken ? `?pageToken=${pageToken}` : ''}`),
    importVideo: (projectId: string, youtubeVideoId: string) =>
      apiClient.post('/shorts-studio/videos/import', { projectId, youtubeVideoId }),
    listImported: (projectId: string) =>
      apiClient.get(`/shorts-studio/projects/${projectId}/videos`),
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
};
