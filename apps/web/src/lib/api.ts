import axios from 'axios';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1';

export const apiClient = axios.create({ baseURL: BASE, withCredentials: true });

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('cf_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    // Only redirect to /login for 401s on authenticated routes.
    // Auth pages (/login, /register) must NOT be redirected — they intentionally
    // receive 401s when credentials are wrong and need to show an error in-place.
    const onAuthPage = typeof window !== 'undefined' &&
      (window.location.pathname === '/login' || window.location.pathname === '/register');
    if (err.response?.status === 401 && typeof window !== 'undefined' && !onAuthPage) {
      localStorage.removeItem('cf_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const api = {
  auth: {
    login: (email: string, password: string) =>
      apiClient.post<{ accessToken: string; user: { id: string; email: string; name: string } }>('/auth/login', { email, password }),
    register: (email: string, password: string, name?: string) =>
      apiClient.post<{ accessToken: string; user: { id: string; email: string; name: string } }>('/auth/register', { email, password, name }),
    me: () =>
      apiClient.get<{ id: string; email: string; name: string; role: string }>('/auth/me'),
  },
  channels: {
    list: () => apiClient.get('/channels'),
    status: () => apiClient.get('/channels/status'),
    getAuthUrl: (redirectUri: string) => apiClient.get(`/channels/auth-url?redirectUri=${encodeURIComponent(redirectUri)}`),
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
  },
  approvals: {
    listPending: () => apiClient.get('/approvals/pending'),
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
  media: {
    listExports: (projectId: string) =>
      apiClient.get<Array<{ name: string; sizeBytes: number }>>(`/media/exports/${projectId}`),
    downloadExport: (projectId: string, fileName: string) =>
      apiClient.get(`/media/exports/${projectId}/${encodeURIComponent(fileName)}`, { responseType: 'blob' }),
  },
  settings: {
    getApiKeys: () =>
      apiClient.get<Array<{ key: string; label: string; masked: string; set: boolean }>>('/settings/api-keys'),
    updateApiKeys: (keys: Record<string, string>) =>
      apiClient.put('/settings/api-keys', keys),
  },
};
