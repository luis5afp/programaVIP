import type {
  AdminSession,
  Assignment,
  AuditLog,
  Client,
  DashboardStats,
  Device,
  HealthInfo,
  Plan,
  Profile,
  ProxyRecord,
} from './types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.message || payload?.error || `HTTP ${response.status}`,
      response.status,
      payload?.code,
    );
  }
  return payload as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: true; user: AdminSession }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  session: () => request<{ ok: true; user: AdminSession }>('/api/auth/session'),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  health: () => request<HealthInfo>('/api/health'),
  dashboard: () => request<DashboardStats>('/api/dashboard'),

  clients: {
    list: () => request<Client[]>('/api/clients'),
    create: (input: {
      name: string;
      email: string;
      phone?: string;
      planId: string;
      startsAt: string;
      expiresAt: string;
      username: string;
      password: string;
    }) => request<Client>('/api/clients', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status'>>) =>
      request<Client>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: true }>(`/api/clients/${id}`, { method: 'DELETE' }),
    credentials: (id: string, username: string, password: string) =>
      request<{ ok: true; username: string }>(`/api/clients/${id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    subscription: (id: string, input: { planId: string; startsAt: string; expiresAt: string }) =>
      request<{ ok: true }>(`/api/clients/${id}/subscription`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  plans: {
    list: () => request<Plan[]>('/api/plans'),
    create: (input: Omit<Plan, 'id' | 'created_at' | 'updated_at'>) =>
      request<Plan>('/api/plans', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Omit<Plan, 'id' | 'created_at' | 'updated_at'>>) =>
      request<Plan>(`/api/plans/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: true }>(`/api/plans/${id}`, { method: 'DELETE' }),
  },

  profiles: {
    list: () => request<Profile[]>('/api/profiles'),
    create: (input: Omit<Profile, 'id' | 'created_at' | 'updated_at' | 'session_ready'>) =>
      request<Profile>('/api/profiles', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>) =>
      request<Profile>(`/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: true }>(`/api/profiles/${id}`, { method: 'DELETE' }),
    uploadImage: (file: File) => {
      const body = new FormData();
      body.append('image', file, file.name || 'profile-image');
      return request<{ ok: true; url: string; path: string; mime: string; size: number }>('/api/profile-images', {
        method: 'POST',
        body,
      });
    },
  },

  proxies: {
    list: () => request<ProxyRecord[]>('/api/proxies'),
    create: (input: {
      name: string;
      host: string;
      port: number;
      username?: string;
      password?: string;
      enabled?: boolean;
    }) => request<ProxyRecord>('/api/proxies', { method: 'POST', body: JSON.stringify(input) }),
    update: (
      id: string,
      input: Partial<{
        name: string;
        host: string;
        port: number;
        username: string | null;
        password: string;
        clearPassword: boolean;
        enabled: boolean;
      }>,
    ) => request<ProxyRecord>(`/api/proxies/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: true }>(`/api/proxies/${id}`, { method: 'DELETE' }),
  },

  assignments: {
    list: () => request<Assignment[]>('/api/assignments'),
    create: (input: { clientId: string; profileId: string; proxyId?: string | null; enabled?: boolean }) =>
      request<Assignment>('/api/assignments', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ proxyId: string | null; enabled: boolean }>) =>
      request<Assignment>(`/api/assignments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (id: string) => request<{ ok: true }>(`/api/assignments/${id}`, { method: 'DELETE' }),
  },

  devices: {
    list: () => request<Device[]>('/api/devices'),
    revoke: (id: string) => request<Device>(`/api/devices/${id}/revoke`, { method: 'POST' }),
    reactivate: (id: string) => request<Device>(`/api/devices/${id}/reactivate`, { method: 'POST' }),
  },

  audit: {
    list: () => request<AuditLog[]>('/api/audit?limit=200'),
  },
};
