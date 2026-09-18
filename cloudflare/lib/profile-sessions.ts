import { AdminIdentity } from './auth';
import { touchProfileClients } from './client-revalidation';
import {
  Env,
  HttpError,
  audit,
  bodyJson,
  decryptProxy,
  encryptProxy,
  json,
  optional,
  sb,
  sha,
  text,
  token,
  uuid,
} from './core';

const CAPTURE_TTL_MS = 15 * 60 * 1000;
const MAX_SESSION_MATERIAL_BYTES = 8_000_000;

function inetHost(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw ? raw.split('/')[0] || null : null;
}

function safeState(profileId: string, credential: any, session: any) {
  return {
    profile_id: profileId,
    has_credentials: Boolean(credential),
    login_username: credential?.login_username || null,
    status: session?.status === 'ready' ? 'active' : session?.status === 'unconfigured' ? 'empty' : session?.status || 'empty',
    version: Number(session?.session_version || 0),
    public_ip: session?.expected_egress_ip || null,
    captured_at: session?.last_captured_at || null,
    validated_at: session?.last_validated_at || null,
    updated_at: session?.updated_at || credential?.updated_at || null,
  };
}

async function profileRow(env: Env, profileId: string) {
  const rows = await sb(
    env,
    `userflex_profiles?select=id,name,url,session_mode,session_ready,enabled,browser_engine,auth_strategy,storage_strategy,network_strategy,extension_strategy&id=eq.${profileId}&limit=1`,
  );
  const profile = rows?.[0];
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'El perfil no existe.');
  return profile;
}

async function defaultProxy(env: Env, profileId: string) {
  const defaults = await sb(
    env,
    `userflex_profile_proxy_defaults?select=proxy_id&profile_id=eq.${profileId}&limit=1`,
  );
  const proxyId = defaults?.[0]?.proxy_id;
  if (!proxyId) return null;
  const proxies = await sb(
    env,
    `userflex_proxies?select=id,name,host,port,username,password_ciphertext,password_iv,enabled,proxy_type,validation_status,public_ip&id=eq.${proxyId}&limit=1`,
  );
  return proxies?.[0] || null;
}

async function credentialRow(env: Env, profileId: string) {
  const rows = await sb(
    env,
    `userflex_profile_credentials?select=profile_id,login_username,password_ciphertext,password_iv,key_version,updated_at&profile_id=eq.${profileId}&limit=1`,
  );
  return rows?.[0] || null;
}

async function sessionRow(env: Env, profileId: string) {
  const rows = await sb(
    env,
    `userflex_profile_sessions?select=profile_id,session_version,status,material_ciphertext,material_iv,material_key_version,expected_egress_ip,last_captured_at,last_validated_at,updated_at&profile_id=eq.${profileId}&limit=1`,
  );
  return rows?.[0] || null;
}

export async function adminProfileSessionRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/profile-session-states' && method === 'GET') {
    const [credentials, sessions] = await Promise.all([
      sb(env, 'userflex_profile_credentials?select=profile_id,login_username,updated_at'),
      sb(env, 'userflex_profile_sessions?select=profile_id,session_version,status,expected_egress_ip,last_captured_at,last_validated_at,updated_at'),
    ]);
    const profileIds = new Set<string>();
    for (const row of credentials || []) profileIds.add(row.profile_id);
    for (const row of sessions || []) profileIds.add(row.profile_id);
    const credentialsById = new Map((credentials || []).map((row: any) => [row.profile_id, row]));
    const sessionsById = new Map((sessions || []).map((row: any) => [row.profile_id, row]));
    return json([...profileIds].map((profileId) => safeState(profileId, credentialsById.get(profileId), sessionsById.get(profileId))));
  }

  const credentialsMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/managed-credentials$/i);
  if (credentialsMatch && method === 'POST') {
    const profileId = uuid(credentialsMatch[1], 'profileId');
    await profileRow(env, profileId);
    const body = await bodyJson(request);
    const loginUsername = text(body.loginUsername, 'loginUsername', 320);
    const existing = await credentialRow(env, profileId);
    const password = typeof body.password === 'string' ? body.password : '';

    let passwordFields: any = {};
    if (password) {
      const encrypted = await encryptProxy(env, text(password, 'password', 1024));
      passwordFields = {
        password_ciphertext: encrypted.ciphertext,
        password_iv: encrypted.iv,
        key_version: encrypted.keyVersion,
      };
    } else if (!existing) {
      throw new HttpError(400, 'PASSWORD_REQUIRED', 'Ingresa la contraseña para preparar la sesión administrada.');
    }

    await sb(env, 'userflex_profile_credentials?on_conflict=profile_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        profile_id: profileId,
        login_username: loginUsername,
        ...passwordFields,
        updated_at: new Date().toISOString(),
      }),
    });
    await sb(env, `userflex_profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.credentials.update', 'profile', profileId, {
      loginUsername,
      passwordChanged: Boolean(password),
    });
    return json({ ok: true, profile_id: profileId, login_username: loginUsername, has_credentials: true });
  }

  const captureMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/session-capture$/i);
  if (captureMatch && method === 'POST') {
    const profileId = uuid(captureMatch[1], 'profileId');
    const profile = await profileRow(env, profileId);
    const authStrategy = profile.auth_strategy || (profile.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
    if (!['cookie-snapshot', 'hybrid'].includes(authStrategy)) {
      throw new HttpError(409, 'SESSION_CAPTURE_NOT_REQUIRED', 'Este tipo de perfil no usa captura de cookies/sesión.');
    }
    const credentials = await credentialRow(env, profileId);
    if (authStrategy === 'hybrid' && !credentials) {
      throw new HttpError(409, 'CREDENTIALS_REQUIRED', 'El modo híbrido necesita credenciales además de la sesión capturada.');
    }
    const proxy = await defaultProxy(env, profileId);
    if (proxy && proxy.enabled !== true) throw new HttpError(409, 'PROFILE_PROXY_DISABLED', 'El proxy del perfil está inactivo.');
    if (proxy?.proxy_type === 'ssh') {
      throw new HttpError(409, 'PROFILE_PROXY_PROTOCOL_UNSUPPORTED', 'El proxy SSH necesita un túnel local y todavía no puede usarse para capturar la sesión.');
    }

    const rawToken = token(32);
    const tokenHash = await sha(`userflex-session-capture:${rawToken}`);
    const expiresAt = new Date(Date.now() + CAPTURE_TTL_MS).toISOString();
    await sb(env, `userflex_profile_session_jobs?profile_id=eq.${profileId}&status=eq.pending`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired' }),
    });
    const jobs = await sb(env, 'userflex_profile_session_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ profile_id: profileId, token_hash: tokenHash, expires_at: expiresAt }),
    });
    const endpoint = url.origin;
    const launchUrl = `userflex-session://capture?endpoint=${encodeURIComponent(endpoint)}&token=${encodeURIComponent(rawToken)}`;
    await audit(env, request, 'admin', admin.userId, 'profile.session.capture.request', 'profile', profileId, {
      jobId: jobs?.[0]?.id || null,
      expiresAt,
      proxyId: proxy?.id || null,
      proxyType: proxy?.proxy_type || null,
      networkMode: proxy ? 'proxy' : 'direct',
    });
    return json({ ok: true, launch_url: launchUrl, expires_at: expiresAt });
  }

  const clearMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/session$/i);
  if (clearMatch && method === 'DELETE') {
    const profileId = uuid(clearMatch[1], 'profileId');
    await profileRow(env, profileId);
    await sb(env, `userflex_profile_sessions?profile_id=eq.${profileId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await sb(env, `userflex_profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_ready: false, updated_at: new Date().toISOString() }),
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.session.clear', 'profile', profileId);
    return json({ ok: true });
  }

  return null;
}

async function captureJob(env: Env, rawToken: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) throw new HttpError(401, 'INVALID_CAPTURE_TOKEN');
  const tokenHash = await sha(`userflex-session-capture:${rawToken}`);
  const rows = await sb(
    env,
    `userflex_profile_session_jobs?select=id,profile_id,status,expires_at,used_at&token_hash=eq.${tokenHash}&limit=1`,
  );
  const job = rows?.[0];
  if (!job || job.status !== 'pending' || job.used_at) throw new HttpError(401, 'CAPTURE_TOKEN_INVALID');
  if (new Date(job.expires_at).getTime() <= Date.now()) {
    await sb(env, `userflex_profile_session_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired' }),
    });
    throw new HttpError(401, 'CAPTURE_TOKEN_EXPIRED');
  }
  return job;
}

export async function publicSessionManagerRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/session-manager/bootstrap' && method === 'POST') {
    const body = await bodyJson(request);
    const rawToken = text(body.token, 'token', 128);
    const job = await captureJob(env, rawToken);
    const profile = await profileRow(env, job.profile_id);
    const credentials = await credentialRow(env, job.profile_id);
    const proxy = await defaultProxy(env, job.profile_id);
    const authStrategy = profile.auth_strategy || (profile.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
    if (authStrategy === 'hybrid' && !credentials) {
      throw new HttpError(409, 'CAPTURE_CONFIGURATION_INVALID', 'El perfil híbrido ya no tiene credenciales guardadas.');
    }
    if (proxy && proxy.enabled !== true) {
      throw new HttpError(409, 'PROFILE_PROXY_DISABLED', 'El proxy del perfil está inactivo.');
    }
    if (proxy?.proxy_type === 'ssh') {
      throw new HttpError(409, 'PROFILE_PROXY_PROTOCOL_UNSUPPORTED', 'El proxy SSH necesita un túnel local y todavía no puede usarse para capturar la sesión.');
    }
    return json({
      ok: true,
      job: { id: job.id, expiresAt: job.expires_at },
      profile: {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        browserEngine: profile.browser_engine || 'chrome-native',
        authStrategy,
        storageStrategy: profile.storage_strategy || 'portable-first-party',
        networkStrategy: profile.network_strategy || 'auto',
        extensionStrategy: profile.extension_strategy || 'custom',
      },
      credentials: credentials ? {
        username: credentials.login_username,
        password: await decryptProxy(env, credentials.password_ciphertext, credentials.password_iv),
      } : null,
      proxy: proxy ? {
        id: proxy.id,
        name: proxy.name,
        host: proxy.host,
        port: proxy.port,
        type: proxy.proxy_type || 'http',
        validationStatus: proxy.validation_status || null,
        publicIp: inetHost(proxy.public_ip),
        username: proxy.username || null,
        password: proxy.password_ciphertext ? await decryptProxy(env, proxy.password_ciphertext, proxy.password_iv) : null,
      } : null,
    });
  }

  if (path === '/api/session-manager/complete' && method === 'POST') {
    const body = await bodyJson(request, 10_000_000);
    const rawToken = text(body.token, 'token', 128);
    const job = await captureJob(env, rawToken);
    const material = body.material;
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
      throw new HttpError(400, 'INVALID_SESSION_MATERIAL');
    }
    const serialized = JSON.stringify(material);
    if (new TextEncoder().encode(serialized).byteLength > MAX_SESSION_MATERIAL_BYTES) {
      throw new HttpError(413, 'SESSION_MATERIAL_TOO_LARGE');
    }
    const encrypted = await encryptProxy(env, serialized);
    const existing = await sessionRow(env, job.profile_id);
    const version = Number(existing?.session_version || 0) + 1;
    const now = new Date().toISOString();
    const publicIp = optional(body.publicIp, 64);
    await sb(env, 'userflex_profile_sessions?on_conflict=profile_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        profile_id: job.profile_id,
        session_version: version,
        status: 'ready',
        material_ciphertext: encrypted.ciphertext,
        material_iv: encrypted.iv,
        material_key_version: encrypted.keyVersion,
        expected_egress_ip: publicIp,
        last_captured_at: now,
        last_validated_at: now,
        updated_at: now,
      }),
    });
    await sb(env, `userflex_profiles?id=eq.${job.profile_id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_ready: true, updated_at: now }),
    });
    await sb(env, `userflex_profile_session_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'completed', used_at: now }),
    });
    await touchProfileClients(env, job.profile_id);
    return json({ ok: true, profile_id: job.profile_id, version, public_ip: publicIp });
  }

  return null;
}

export async function managedProfileCredentials(env: Env, profileId: string) {
  const row = await credentialRow(env, profileId);
  if (!row) return null;
  return {
    username: row.login_username,
    password: await decryptProxy(env, row.password_ciphertext, row.password_iv),
    updatedAt: row.updated_at || null,
  };
}

export async function managedSessionMaterial(env: Env, profileId: string) {
  const row = await sessionRow(env, profileId);
  if (!row || row.status !== 'ready' || !row.material_ciphertext || !row.material_iv) return null;
  const raw = await decryptProxy(env, row.material_ciphertext, row.material_iv);
  let material: unknown;
  try {
    material = JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'SESSION_MATERIAL_INVALID');
  }
  return {
    version: Number(row.session_version || 0),
    status: 'active',
    publicIp: row.expected_egress_ip || null,
    capturedAt: row.last_captured_at || null,
    validatedAt: row.last_validated_at || null,
    material,
  };
}
