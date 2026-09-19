import { scrypt } from 'scrypt-js';
import {
  ADMIN_COOKIE,
  ADMIN_MAX_AGE,
  CLIENT_SESSION_SECONDS,
  DEFAULT_AUTH_ORIGIN,
  Env,
  HttpError,
  adminCookie,
  audit,
  bodyJson,
  clearAdminCookie,
  cookie,
  json,
  loginGuard,
  passwordVerify,
  resetGuard,
  sb,
  sha,
  text,
  token,
} from './core';

export type AdminRole = 'owner' | 'admin';
export type AdminIdentity = {
  userId: string;
  username: string;
  sessionId: string;
  role: AdminRole;
  displayName: string;
  email: string | null;
};
export type ClientIdentity = {
  clientId: string;
  deviceId: string;
  sessionId: string;
  client: any;
  plan: any;
  subscription: any;
};

type AdminProfile = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: AdminRole;
  last_login_at: string | null;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function verifyLegacyAdminPassword(password: string, encoded: string) {
  if (encoded.startsWith('pbkdf2-sha256$')) return passwordVerify(password, encoded);
  try {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (N !== 16384 || r !== 8 || p !== 1) return false;
    const salt = decodeBase64Url(parts[4]);
    const expected = decodeBase64Url(parts[5]);
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(new TextEncoder().encode(password), salt, N, r, p, 64);
    let diff = 0;
    for (let index = 0; index < 64; index += 1) diff |= actual[index] ^ expected[index];
    return diff === 0;
  } catch {
    return false;
  }
}

async function verifyAdminPassword(env: Env, user: any, password: string) {
  const encoded = typeof user?.password_hash === 'string' ? user.password_hash : '';
  if (!encoded) return false;
  if (/^\$2[aby]\$/.test(encoded)) {
    const result = await sb(env, 'rpc/userflex_verify_admin_password', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: user.id, p_password: password }),
    });
    return result === true || (Array.isArray(result) && result[0] === true);
  }
  return verifyLegacyAdminPassword(password, encoded);
}

async function verifyClientPassword(env: Env, cred: any, password: string) {
  if (typeof cred?.password_hash !== 'string') return false;
  if (/^\$2[aby]\$/.test(cred.password_hash)) {
    const result = await sb(env, 'rpc/userflex_verify_client_password', {
      method: 'POST',
      body: JSON.stringify({ p_client_id: cred.client_id, p_password: password }),
    });
    return result === true || (Array.isArray(result) && result[0] === true);
  }
  return passwordVerify(password, cred.password_hash);
}

async function getAdminProfile(env: Env, userId: string): Promise<AdminProfile | null> {
  const rows = await sb(
    env,
    `userflex_admin_profiles?select=user_id,display_name,email,role,last_login_at&user_id=eq.${userId}&limit=1`,
  );
  return rows?.[0] || null;
}

async function ensureAdminProfile(env: Env, user: { id: string; username: string }): Promise<AdminProfile | null> {
  const current = await getAdminProfile(env, user.id);
  if (current) return current;

  // Safe one-time bootstrap: before any explicit userFLEX administrator exists,
  // the first already-authorized legacy admin becomes the initial owner.
  const existing = await sb(env, 'userflex_admin_profiles?select=user_id&limit=1');
  if (existing?.length) return null;

  const email = user.username.includes('@') ? user.username.toLowerCase() : null;
  const created = await sb(env, 'userflex_admin_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: user.id,
      display_name: user.username,
      email,
      role: 'owner',
      last_login_at: null,
    }),
  });
  return created?.[0] || null;
}

function adminUserPayload(user: { id: string; username: string }, profile: AdminProfile) {
  return {
    id: user.id,
    username: user.username,
    display_name: profile.display_name,
    email: profile.email,
    role: profile.role,
  };
}

export async function requireAdmin(request: Request, env: Env): Promise<AdminIdentity> {
  const raw = cookie(request, ADMIN_COOKIE);
  if (!raw || raw.length < 32 || raw.length > 128) throw new HttpError(401, 'UNAUTHENTICATED');
  const hash = await sha(raw);
  const rows = await sb(
    env,
    `vsixteen_login_sessions?select=id,user_id,expires_at&token_hash=eq.${hash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  const session = rows?.[0];
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED');
  const users = await sb(
    env,
    `vsixteen_users?select=id,username,enabled&id=eq.${session.user_id}&enabled=eq.true&limit=1`,
  );
  const user = users?.[0];
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED');
  const profile = await ensureAdminProfile(env, user);
  if (!profile) throw new HttpError(403, 'ADMIN_ACCESS_REVOKED', 'Esta cuenta no tiene acceso al panel userFLEX.');
  void sb(env, `vsixteen_login_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
  }).catch(() => {});
  return {
    userId: user.id,
    username: user.username,
    sessionId: session.id,
    role: profile.role,
    displayName: profile.display_name,
    email: profile.email,
  };
}

async function directAdminLogin(request: Request, env: Env, user: any, password: string, guard: string) {
  if (user.enabled !== true) throw new HttpError(403, 'ACCOUNT_DISABLED', 'La cuenta está deshabilitada.');
  if (!(await verifyAdminPassword(env, user, password))) throw new HttpError(401, 'INVALID_CREDENTIALS');
  const profile = await ensureAdminProfile(env, user);
  if (!profile) throw new HttpError(403, 'ADMIN_ACCESS_REVOKED', 'Esta cuenta no tiene acceso al panel userFLEX.');
  await resetGuard(env, guard);
  const raw = token();
  const hash = await sha(raw);
  const expiresAt = new Date(Date.now() + ADMIN_MAX_AGE * 1000).toISOString();
  await sb(env, 'vsixteen_login_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: user.id, token_hash: hash, expires_at: expiresAt }),
  });
  const now = new Date().toISOString();
  await sb(env, `userflex_admin_profiles?user_id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_login_at: now, updated_at: now }),
  });
  await audit(env, request, 'admin', user.id, 'admin.login', 'admin_user', user.id, { role: profile.role });
  return json({ ok: true, user: adminUserPayload(user, { ...profile, last_login_at: now }) }, 200, {
    'Set-Cookie': adminCookie(raw),
  });
}

export async function adminLogin(request: Request, env: Env) {
  const guard = await loginGuard(env, request, 'admin');
  const body = await bodyJson(request, 16384);
  const username = text(body.username, 'username', 120);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 512) throw new HttpError(400, 'INVALID_CREDENTIALS');
  const localUsers = await sb(
    env,
    `vsixteen_users?select=id,username,password_hash,enabled&username=eq.${encodeURIComponent(username)}&limit=1`,
  );
  const localUser = localUsers?.[0];
  if (localUser) return directAdminLogin(request, env, localUser, password, guard);

  const origin = (env.CREATORTOOLS_AUTH_ORIGIN || DEFAULT_AUTH_ORIGIN).replace(/\/$/, '');
  const upstream = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  if (!upstream.ok) {
    if ([400, 401, 403].includes(upstream.status)) throw new HttpError(401, 'INVALID_CREDENTIALS');
    throw new HttpError(503, 'AUTH_BACKEND_UNAVAILABLE');
  }
  const setCookie = upstream.headers.get('set-cookie') || '';
  const match = setCookie.match(/ct_session=([^;]+)/i);
  if (!match) throw new HttpError(503, 'AUTH_SESSION_MISSING');
  const raw = decodeURIComponent(match[1]);
  const hash = await sha(raw);
  const sessions = await sb(env, `vsixteen_login_sessions?select=id,user_id&token_hash=eq.${hash}&limit=1`);
  const session = sessions?.[0];
  if (!session?.user_id) throw new HttpError(503, 'AUTH_SESSION_MISSING');
  const users = await sb(
    env,
    `vsixteen_users?select=id,username,enabled&id=eq.${session.user_id}&enabled=eq.true&limit=1`,
  );
  const user = users?.[0];
  if (!user) throw new HttpError(503, 'AUTH_SESSION_MISSING');
  const profile = await ensureAdminProfile(env, user);
  if (!profile) {
    await sb(env, `vsixteen_login_sessions?id=eq.${session.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    throw new HttpError(403, 'ADMIN_ACCESS_REVOKED', 'Esta cuenta no tiene acceso al panel userFLEX.');
  }
  await resetGuard(env, guard);
  const now = new Date().toISOString();
  await sb(env, `userflex_admin_profiles?user_id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_login_at: now, updated_at: now }),
  });
  await audit(env, request, 'admin', user.id, 'admin.login', 'admin_user', user.id, { role: profile.role });
  return json({ ok: true, user: adminUserPayload(user, { ...profile, last_login_at: now }) }, 200, {
    'Set-Cookie': adminCookie(raw),
  });
}

export async function adminLogout(request: Request, env: Env) {
  const raw = cookie(request, ADMIN_COOKIE);
  if (raw) {
    const hash = await sha(raw);
    await sb(env, `vsixteen_login_sessions?token_hash=eq.${hash}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie() });
}

export async function entitlement(env: Env, clientId: string) {
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await sb(
    env,
    `userflex_subscriptions?select=id,client_id,plan_id,starts_at,expires_at,status,offline_grace_minutes&client_id=eq.${clientId}&status=eq.active&starts_at=lte.${now}&expires_at=gt.${now}&order=expires_at.desc&limit=1`,
  );
  const subscription = rows?.[0];
  if (!subscription) throw new HttpError(403, 'SUBSCRIPTION_INACTIVE', 'La suscripción no está activa.');
  const plans = await sb(
    env,
    `userflex_plans?select=id,name,duration_days,max_profiles,enabled&id=eq.${subscription.plan_id}&enabled=eq.true&limit=1`,
  );
  const plan = plans?.[0];
  if (!plan) throw new HttpError(403, 'PLAN_INACTIVE', 'El plan no está activo.');
  return { subscription, plan };
}

export async function requireClient(request: Request, env: Env): Promise<ClientIdentity> {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/);
  if (!match) throw new HttpError(401, 'CLIENT_UNAUTHENTICATED');
  const hash = await sha(match[1]);
  const now = encodeURIComponent(new Date().toISOString());
  const sessions = await sb(
    env,
    `userflex_client_sessions?select=id,client_id,device_id&token_hash=eq.${hash}&revoked_at=is.null&expires_at=gt.${now}&limit=1`,
  );
  const session = sessions?.[0];
  if (!session) throw new HttpError(401, 'CLIENT_UNAUTHENTICATED');
  const clients = await sb(
    env,
    `userflex_clients?select=id,name,email,status,max_devices,allow_external_browsing,updated_at&id=eq.${session.client_id}&status=eq.active&limit=1`,
  );
  if (!clients?.[0]) throw new HttpError(403, 'CLIENT_SUSPENDED');
  const devices = await sb(
    env,
    `userflex_devices?select=id&id=eq.${session.device_id}&client_id=eq.${session.client_id}&status=eq.active&limit=1`,
  );
  if (!devices?.[0]) throw new HttpError(403, 'DEVICE_REVOKED');
  const { subscription, plan } = await entitlement(env, session.client_id);
  const stamp = new Date().toISOString();
  const clientIp = request.headers.get('cf-connecting-ip');
  void sb(env, `userflex_client_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: stamp }),
  }).catch(() => {});
  void sb(env, `userflex_devices?id=eq.${session.device_id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: stamp, ...(clientIp ? { last_ip: clientIp } : {}) }),
  }).catch(() => {});
  return {
    clientId: session.client_id,
    deviceId: session.device_id,
    sessionId: session.id,
    client: clients[0],
    plan,
    subscription,
  };
}

export async function clientLogin(request: Request, env: Env) {
  const body = await bodyJson(request, 24576);
  const identifier = text(body.identifier, 'identifier', 160).toLowerCase();
  const guard = await loginGuard(env, request, 'client', identifier);
  const password = typeof body.password === 'string' ? body.password : '';
  const deviceKey = text(body.deviceKey, 'deviceKey', 512);
  const deviceName = text(body.deviceName, 'deviceName', 120);
  const os = typeof body.os === 'string' ? body.os.trim().slice(0, 120) : null;
  if (!password || password.length > 256) throw new HttpError(401, 'INVALID_CLIENT_CREDENTIALS');
  let rows = await sb(
    env,
    `userflex_client_credentials?select=client_id,username,password_hash&username=eq.${encodeURIComponent(identifier)}&limit=1`,
  );
  let cred = rows?.[0];
  if (!cred) {
    const c = await sb(env, `userflex_clients?select=id&email=eq.${encodeURIComponent(identifier)}&limit=1`);
    if (c?.[0]) {
      rows = await sb(
        env,
        `userflex_client_credentials?select=client_id,username,password_hash&client_id=eq.${c[0].id}&limit=1`,
      );
      cred = rows?.[0];
    }
  }
  if (!cred || !(await verifyClientPassword(env, cred, password))) {
    throw new HttpError(401, 'INVALID_CLIENT_CREDENTIALS');
  }
  await resetGuard(env, guard);
  const clients = await sb(
    env,
    `userflex_clients?select=id,name,email,status,max_devices,allow_external_browsing,updated_at&id=eq.${cred.client_id}&limit=1`,
  );
  const client = clients?.[0];
  if (!client || client.status !== 'active') throw new HttpError(403, 'CLIENT_SUSPENDED');
  const { subscription, plan } = await entitlement(env, client.id);
  const deviceHash = await sha(`userflex-device:${deviceKey}`);
  const registered = await sb(env, 'rpc/userflex_register_device', {
    method: 'POST',
    body: JSON.stringify({
      p_client_id: client.id,
      p_device_hash: deviceHash,
      p_name: deviceName,
      p_os: os,
      p_max_devices: Number(client.max_devices || 1),
    }),
  });
  const device = Array.isArray(registered) ? registered[0] : registered;
  if (!device) throw new HttpError(503, 'DEVICE_REGISTRATION_FAILED');
  if (device.status === 'revoked') throw new HttpError(403, 'DEVICE_REVOKED');
  if (device.status === 'limit_reached') {
    throw new HttpError(403, 'DEVICE_LIMIT_REACHED', 'Se alcanzó el máximo de dispositivos permitido para este cliente.');
  }
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    await sb(env, `userflex_devices?id=eq.${device.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_ip: clientIp, last_seen_at: new Date().toISOString() }),
    });
  }
  const raw = token();
  const hash = await sha(raw);
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_SECONDS * 1000).toISOString();
  await sb(env, 'userflex_client_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      client_id: client.id,
      device_id: device.id,
      token_hash: hash,
      expires_at: expiresAt,
      last_seen_at: new Date().toISOString(),
    }),
  });
  await audit(env, request, 'client', client.id, 'client.login', 'device', device.id, { username: cred.username });
  return json({
    ok: true,
    accessToken: raw,
    expiresAt,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      configRevision: client.updated_at,
      allowExternalBrowsing: client.allow_external_browsing === true,
    },
    plan: { id: plan.id, name: plan.name },
    subscription: {
      expiresAt: subscription.expires_at,
      offlineGraceMinutes: Number(subscription.offline_grace_minutes || 0),
    },
  });
}
