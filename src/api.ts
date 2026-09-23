import type {
  AdminSession,
  Assignment,
  AuditLog,
  Client,
  ClientReleaseStatus,
  CookieImportInspection,
  DashboardStats,
  Device,
  HealthInfo,
  ManagedExtension,
  ExtensionValidationJob,
  ProfileExtensionMembership,
  Plan,
  Profile,
  ProfileUsage,
  ProfileProxyDefault,
  ProfileSessionState,
  SessionAlertSummary,
  ProfileValidation,
  ProfileValidationJob,
  ProxyRecord,
} from './types';

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = RequestInit & { timeoutMs?: number };

const REQUEST_TIMEOUT_MS = 20_000;
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 502, 503, 504]);

function safeToRetry(method: string) {
  return method === 'GET' || method === 'HEAD';
}

function requestId() {
  try { return crypto.randomUUID(); } catch { return `uf-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => window.setTimeout(resolve, 250 * attempt));
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchInit } = init;
  const method = String(fetchInit.method || 'GET').toUpperCase();
  const retryable = safeToRetry(method);
  const maxAttempts = retryable ? 3 : 1;
  const operationId = requestId();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers = new Headers(fetchInit.headers);
    const isFormData = typeof FormData !== 'undefined' && fetchInit.body instanceof FormData;
    if (fetchInit.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('X-Userflex-Request-Id', operationId);

    const controller = new AbortController();
    const externalSignal = fetchInit.signal;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abortFromCaller();
      else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(path, {
        ...fetchInit,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: any = null;
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = { error: text }; }
      }

      if (!response.ok) {
        if (retryable && RETRYABLE_HTTP_STATUS.has(response.status) && attempt < maxAttempts) {
          await retryDelay(attempt);
          continue;
        }
        const error = new ApiError(
          payload?.message || payload?.error || `HTTP ${response.status}`,
          response.status,
          payload?.code,
        );
        error.requestId =
          response.headers.get('X-Userflex-Request-Id') || operationId;
        throw error;
      }
      return payload as T;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError) throw error;
      if (externalSignal?.aborted) throw new ApiError('La operación fue cancelada.', 0, 'REQUEST_CANCELLED');
      if (retryable && attempt < maxAttempts) {
        await retryDelay(attempt);
        continue;
      }
      const timedOut = controller.signal.aborted;
      const failure = new ApiError(
        timedOut ? 'El servidor tardó demasiado en responder. Intenta nuevamente.' : 'No se pudo conectar con userFLEX.',
        0,
        timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      );
      failure.requestId = operationId;
      throw failure;
    } finally {
      window.clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError instanceof Error ? lastError : new ApiError('No se pudo completar la solicitud.', 0, 'REQUEST_FAILED');
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
  clientRelease: {
    get: () => request<{ ok: true } & ClientReleaseStatus>('/api/system/client-release'),
    activate: (version: string) =>
      request<{ ok: true } & ClientReleaseStatus>('/api/system/client-release/activate', {
        method: 'POST',
        body: JSON.stringify({ version }),
      }),
  },
  dashboard: () => request<DashboardStats>('/api/dashboard'),

  clients: {
    list: () => request<Client[]>('/api/clients'),
    create: (input: {
      name: string;
      email: string;
      phone?: string;
      maxDevices: number;
      planId: string;
      startsAt: string;
      expiresAt: string;
      username: string;
      password: string;
    }) => request<Client>('/api/clients', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status' | 'max_devices' | 'allow_external_browsing'>>) =>
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

  extensions: {
    list: () => request<ManagedExtension[]>('/api/extensions'),
    create: (input: { name: string; description?: string; scope: 'global' | 'selective'; package: File }) => {
      const body = new FormData();
      body.append('name', input.name);
      body.append('description', input.description || '');
      body.append('scope', input.scope);
      body.append('package', input.package, input.package.name || 'extension.zip');
      return request<ManagedExtension>('/api/extensions', { method: 'POST', body });
    },
    update: (id: string, input: Partial<Pick<ManagedExtension, 'name' | 'description' | 'scope' | 'enabled'>>) =>
      request<ManagedExtension>(`/api/extensions/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    uploadPackage: (id: string, file: File) => {
      const body = new FormData();
      body.append('package', file, file.name || 'extension.zip');
      return request<ManagedExtension>(`/api/extensions/${id}/package`, { method: 'POST', body });
    },
    setProfiles: (id: string, profileIds: string[]) =>
      request<{ ok: true; extension_id: string; profile_ids: string[] }>(`/api/extensions/${id}/profiles`, {
        method: 'POST',
        body: JSON.stringify({ profileIds }),
      }),
    runtimeTest: (id: string) =>
      request<{ ok: true; job_id: string; launch_url: string; expires_at: string }>(`/api/extensions/${id}/runtime-test`, {
        method: 'POST',
      }),
    testStatus: (jobId: string) =>
      request<{ ok: true; job: ExtensionValidationJob }>(`/api/extension-tests/${jobId}`),
    remove: (id: string) => request<{ ok: true }>(`/api/extensions/${id}`, { method: 'DELETE' }),
  },

  profileExtensions: {
    list: () => request<ProfileExtensionMembership[]>('/api/profile-extension-memberships'),
    set: (profileId: string, extensionIds: string[]) =>
      request<{ ok: true; profile_id: string; extension_ids: string[] }>(`/api/profiles/${profileId}/extensions`, {
        method: 'POST',
        body: JSON.stringify({ extensionIds }),
      }),
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

  profilePlans: {
    list: () => request<Array<{ profile_id: string; plan_id: string; created_at: string }>>('/api/profile-plan-memberships'),
    set: (profileId: string, planIds: string[]) =>
      request<{ ok: true; profile_id: string; plan_ids: string[] }>(`/api/profiles/${profileId}/plans`, {
        method: 'POST',
        body: JSON.stringify({ planIds }),
      }),
  },

  profileProxyDefaults: {
    list: () => request<ProfileProxyDefault[]>('/api/profile-proxy-defaults'),
    set: (profileId: string, proxyId: string | null) =>
      request<{ ok: true; profile_id: string; proxy_id: string | null }>(`/api/profiles/${profileId}/default-proxy`, {
        method: 'POST',
        body: JSON.stringify({ proxyId }),
      }),
  },

  profileSessions: {
    list: () => request<ProfileSessionState[]>('/api/profile-session-states'),
    alerts: () => request<SessionAlertSummary>('/api/profile-session-alerts'),
    requestChecks: () => request<{ ok: true; requested: number }>('/api/profile-session-checks/request', { method: 'POST' }),
    inspectCookies: (file: File, url: string) => {
      const body = new FormData();
      body.append('cookies', file, file.name || 'cookies.json');
      body.append('url', url);
      return request<{ ok: true; inspection: CookieImportInspection }>('/api/cookie-import/inspect', {
        method: 'POST',
        body,
      });
    },
    importCookies: (profileId: string, file: File) => {
      const body = new FormData();
      body.append('cookies', file, file.name || 'cookies.json');
      return request<{
        ok: true;
        profile_id: string;
        version: number;
        imported_at: string;
        inspection: CookieImportInspection;
      }>(`/api/profiles/${profileId}/session-import`, {
        method: 'POST',
        body,
      });
    },
    credentials: (profileId: string, loginUsername: string, password?: string) =>
      request<{ ok: true; profile_id: string; login_username: string; has_credentials: true }>(
        `/api/profiles/${profileId}/managed-credentials`,
        { method: 'POST', body: JSON.stringify({ loginUsername, password: password || '' }) },
      ),
    clearCredentials: (profileId: string) =>
      request<{ ok: true; profile_id: string; has_credentials: false }>(
        `/api/profiles/${profileId}/managed-credentials`,
        { method: 'DELETE' },
      ),
    guest: (profileId: string) =>
      request<{ ok: true; launch_url: string; expires_at: string }>(`/api/profiles/${profileId}/guest-launch`, {
        method: 'POST',
      }),
    capture: (profileId: string) =>
      request<{ ok: true; launch_url: string; save_url: string; expires_at: string }>(`/api/profiles/${profileId}/session-capture`, {
        method: 'POST',
      }),
    validate: (profileId: string, clientId?: string | null) =>
      request<{ ok: true; validation: ProfileValidation }>(`/api/profiles/${profileId}/validation`, {
        method: 'POST',
        body: JSON.stringify({ clientId: clientId || null }),
      }),
    clientTest: (profileId: string, clientId?: string | null) =>
      request<{ ok: true; job_id: string; launch_url: string; expires_at: string; validation: ProfileValidation }>(
        `/api/profiles/${profileId}/client-test`,
        { method: 'POST', body: JSON.stringify({ clientId: clientId || null }) },
      ),
    testStatus: (jobId: string) =>
      request<{ ok: true; job: ProfileValidationJob }>(`/api/profile-tests/${jobId}`),
    clear: (profileId: string) => request<{ ok: true }>(`/api/profiles/${profileId}/session`, { method: 'DELETE' }),
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
    validate: (id: string) => request<ProxyRecord>(`/api/proxies/${id}/validate`, { method: 'POST' }),
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

  profileUsage: {
    list: () => request<ProfileUsage[]>('/api/profile-usage?limit=2000'),
  },

  audit: {
    list: () => request<AuditLog[]>('/api/audit?limit=200'),
  },
};
