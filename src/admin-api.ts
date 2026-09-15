import { ApiError } from './api';
import type { AdminRole, AdminUser } from './types';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const raw = await response.text();
  let payload: any = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = { error: raw }; }
  }
  if (!response.ok) {
    throw new ApiError(payload?.message || payload?.error || `HTTP ${response.status}`, response.status, payload?.code);
  }
  return payload as T;
}

export const adminUsersApi = {
  list: () => request<AdminUser[]>('/api/admin-users'),
  create: (input: { username: string; password: string; displayName: string; email?: string; role: AdminRole }) =>
    request<AdminUser>('/api/admin-users', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<{ displayName: string; email: string | null; role: AdminRole; enabled: boolean }>) =>
    request<AdminUser>(`/api/admin-users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  password: (id: string, password: string) =>
    request<{ ok: true }>(`/api/admin-users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
  remove: (id: string) => request<{ ok: true }>(`/api/admin-users/${id}`, { method: 'DELETE' }),
};
