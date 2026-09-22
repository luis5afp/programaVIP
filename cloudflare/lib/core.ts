export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
}

export interface R2ObjectsLike {
  objects: R2ObjectLike[];
  truncated: boolean;
  cursor?: string;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike>;
}

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  CLIENT_RELEASES?: R2BucketLike;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  USERFLEX_PROXY_MASTER_KEY?: string;
  USERFLEX_PROXY_KEY_VERSION?: string;
  CREATORTOOLS_AUTH_ORIGIN?: string;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const ADMIN_COOKIE = 'uf_admin_session';
export const ADMIN_MAX_AGE = 8 * 60 * 60;
export const CLIENT_SESSION_SECONDS = 24 * 60 * 60;
export const PBKDF2_ITERATIONS = 310_000;
export const DEFAULT_AUTH_ORIGIN = 'https://creatortools-reconstruction-lab.luis5afp.workers.dev';

export function securityHeaders(): Headers {
  return new Headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = securityHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(data), { status, headers });
}

export function withSecurity(response: Response): Response {
  const headers = new Headers(response.headers);
  securityHeaders().forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function requireSameOriginWrite(request: Request): void {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();

  // Normal browsers send Origin for state-changing fetches. Some privacy
  // configurations (notably Brave shields/extensions) can omit Origin on a
  // legitimate same-origin request while still preserving Sec-Fetch-Site.
  // Accept that exact browser case, but never accept cross-site traffic.
  if (origin) {
    if (origin !== expected) {
      throw new HttpError(403, 'ORIGIN_REJECTED', 'La solicitud no proviene del panel userFLEX.');
    }
  } else if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'ORIGIN_REJECTED', 'El navegador no pudo confirmar el origen seguro de la solicitud.');
  }

  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'ORIGIN_REJECTED', 'La solicitud no proviene del panel userFLEX.');
  }
}

function config(env: Env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'SUPABASE_CONFIG_MISSING', 'Supabase no está configurado.');
  return { url, key };
}

export async function sb(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const { url, key } = config(env);
  const method = String(init.method || 'GET').toUpperCase();
  const retryable = method === 'GET' || method === 'HEAD';
  const maxAttempts = retryable ? 3 : 1;
  let response: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set('apikey', key);
    headers.set('Authorization', `Bearer ${key}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    try {
      response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.error('Supabase network error', path, error instanceof Error ? error.message : String(error));
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no respondió a tiempo. Intenta nuevamente.');
    }

    if (retryable && [408, 425, 429, 502, 503, 504].includes(response.status) && attempt < maxAttempts) {
      await response.text().catch(() => '');
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      continue;
    }
    break;
  }

  if (!response) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible.');

  const raw = await response.text();
  let body: any = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  if (!response.ok) {
    const message = typeof body === 'string' ? body : body?.message || body?.code || '';
    const normalized = String(message);
    console.error('Supabase', response.status, path, normalized.slice(0, 180));
    if (normalized.includes('USERFLEX_PROFILE_LIMIT_REACHED')) {
      throw new HttpError(409, 'PROFILE_LIMIT_REACHED', 'El plan ya alcanzó el máximo de perfiles.');
    }
    if (normalized.includes('USERFLEX_SUBSCRIPTION_INACTIVE')) {
      throw new HttpError(409, 'SUBSCRIPTION_INACTIVE', 'El cliente no tiene una suscripción activa.');
    }
    if (normalized.includes('USERFLEX_DEVICE_LIMIT_REACHED')) {
      throw new HttpError(409, 'DEVICE_LIMIT_REACHED', 'El plan ya alcanzó el máximo de dispositivos.');
    }
    if (normalized.includes('USERFLEX_PLAN_INACTIVE')) {
      throw new HttpError(409, 'PLAN_INACTIVE', 'El plan seleccionado no está activo.');
    }
    if (response.status === 409 || body?.code === '23505') {
      throw new HttpError(409, 'CONFLICT', 'Ya existe un registro con esos datos.');
    }
    if (body?.code === '23503') {
      throw new HttpError(409, 'IN_USE', 'El registro todavía está siendo utilizado.');
    }
    if ([408, 425, 429, 502, 503, 504].includes(response.status)) {
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'La base de datos está temporalmente ocupada. Intenta nuevamente.');
    }
    throw new HttpError(502, 'DATABASE_ERROR', 'No se pudo completar la operación en la base de datos.');
  }
  return body;
}

export async function bodyJson(request: Request, max = 32768): Promise<any> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  const raw = await request.text();
  if (raw.length > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

export function text(value: unknown, field: string, max = 255) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max) throw new HttpError(400, 'INVALID_FIELD', `${field} no es válido.`);
  return result;
}

export function optional(value: unknown, max = 255): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, 'INVALID_FIELD');
  return value.trim();
}

export function uuid(value: unknown, field: string) {
  const result = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new HttpError(400, 'INVALID_ID', `${field} no es válido.`);
  }
  return result;
}

export function integer(value: unknown, min: number, max: number, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} no es válido.`);
  }
  return number;
}

export function iso(value: unknown, field: string) {
  const raw = text(value, field, 80);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'INVALID_FIELD', `${field} no es válido.`);
  return date.toISOString();
}

export function httpsUrl(value: unknown, field: string, optionalValue = false): string | null {
  if (optionalValue && (value === undefined || value === null || value === '')) return null;
  const raw = text(value, field, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'INVALID_URL');
  }
  if (url.protocol !== 'https:') throw new HttpError(400, 'HTTPS_REQUIRED', `${field} debe usar HTTPS.`);
  url.username = '';
  url.password = '';
  return url.toString();
}

export function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function adminCookie(value: string, maxAge = ADMIN_MAX_AGE) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function b64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unb64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function token(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return b64(value);
}

export async function sha(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function passwordHash(password: string) {
  if (password.length < 6 || password.length > 256) {
    throw new HttpError(400, 'WEAK_PASSWORD', 'La contraseña debe tener al menos 6 caracteres.');
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
      material,
      256,
    ),
  );
  return 'pbkdf2-sha256$' + PBKDF2_ITERATIONS + '$' + b64(salt) + '$' + b64(derived);
}

export async function passwordVerify(password: string, encoded: string) {
  try {
    const [kind, iterations, saltValue, expectedValue] = encoded.split('$');
    if (kind !== 'pbkdf2-sha256' || Number(iterations) !== PBKDF2_ITERATIONS) return false;
    const salt = unb64(saltValue);
    const expected = unb64(expectedValue);
    if (salt.length !== 16 || expected.length !== 32) return false;
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const actual = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
        material,
        256,
      ),
    );
    let diff = 0;
    for (let index = 0; index < 32; index += 1) diff |= actual[index] ^ expected[index];
    return diff === 0;
  } catch {
    return false;
  }
}

async function proxyKey(env: Env) {
  if (!env.USERFLEX_PROXY_MASTER_KEY) throw new HttpError(503, 'PROXY_ENCRYPTION_NOT_CONFIGURED');
  const bytes = unb64(env.USERFLEX_PROXY_MASTER_KEY);
  if (bytes.length !== 32) throw new HttpError(503, 'PROXY_ENCRYPTION_INVALID');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptProxy(env: Env, password: string) {
  const key = await proxyKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password)),
  );
  return {
    ciphertext: b64(ciphertext),
    iv: b64(iv),
    keyVersion: env.USERFLEX_PROXY_KEY_VERSION || 'v1',
  };
}

export async function decryptProxy(env: Env, ciphertext: string, iv: string) {
  const key = await proxyKey(env);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ciphertext)),
  );
}

export async function audit(
  env: Env,
  request: Request,
  actorType: 'admin' | 'client' | 'system',
  actorId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details: Record<string, unknown> = {},
) {
  const ip = request.headers.get('cf-connecting-ip');
  const ipHash = ip ? await sha(`userflex-ip:${ip}`) : null;
  await sb(env, 'userflex_audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_type: actorType,
      actor_id: actorId,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      ip_hash: ipHash,
      details,
    }),
  });
}

export async function loginGuard(env: Env, request: Request, scope: string, identity = '') {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = await sha(`userflex-login:${scope}:${ip}:${identity.toLowerCase()}`);
  const result = await sb(env, 'rpc/userflex_login_guard', {
    method: 'POST',
    body: JSON.stringify({ p_ip_hash: key }),
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (row?.allowed === false) throw new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos.');
  return key;
}

export async function resetGuard(env: Env, key: string) {
  await sb(env, 'rpc/userflex_login_guard_reset', {
    method: 'POST',
    body: JSON.stringify({ p_ip_hash: key }),
  });
}
