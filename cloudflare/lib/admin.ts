import { AdminIdentity } from './auth';
import { clientIdsForPlans, clientIdsForProfile, clientIdsForProxy, touchClientConfig, touchClientsConfig, touchPlanClients, touchProfileClients, touchProxyClients } from './client-revalidation';
import { requestKeeperChecks } from './keeper-revalidation';
import { closeOpenProfileUsageForClient, closeOpenProfileUsageForDevice } from './profile-usage';
import {
  AUTH_STRATEGIES,
  BROWSER_ENGINES,
  EXTENSION_STRATEGIES,
  NETWORK_STRATEGIES,
  STORAGE_STRATEGIES,
  runtimeForProfile,
  sameOrigin,
  snapshotAuthentication,
} from './profile-runtime';
import {
  Env,
  HttpError,
  audit,
  bodyJson,
  encryptProxy,
  httpsUrl,
  integer,
  iso,
  json,
  optional,
  passwordHash,
  sb,
  text,
  uuid,
} from './core';

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 40));
}


function profileChoice(value: unknown, allowed: readonly string[], fallback: string, code: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new HttpError(400, code);
  return value;
}

function runtimeDefaults(body: any) {
  const legacyManaged = body?.session_mode === 'managed-first-party';
  const auth = profileChoice(body?.auth_strategy, AUTH_STRATEGIES, legacyManaged ? 'cookie-snapshot' : 'manual', 'INVALID_AUTH_STRATEGY');
  return {
    browser_engine: profileChoice(body?.browser_engine, BROWSER_ENGINES, 'chrome-native', 'INVALID_BROWSER_ENGINE'),
    auth_strategy: auth,
    storage_strategy: profileChoice(
      body?.storage_strategy,
      STORAGE_STRATEGIES,
      auth === 'manual' || auth === 'credential-autofill' ? 'local-persistent' : 'portable-first-party',
      'INVALID_STORAGE_STRATEGY',
    ),
    network_strategy: profileChoice(body?.network_strategy, NETWORK_STRATEGIES, 'auto', 'INVALID_NETWORK_STRATEGY'),
    extension_strategy: profileChoice(body?.extension_strategy, EXTENSION_STRATEGIES, auth === 'manual' ? 'guard-only' : 'custom', 'INVALID_EXTENSION_STRATEGY'),
    session_mode: auth === 'manual' ? 'manual-login' : 'managed-first-party',
  };
}

function proxyHost(value: unknown): string {
  const host = text(value, 'host', 255);
  if (/[\s/@]/.test(host)) throw new HttpError(400, 'INVALID_PROXY_HOST', 'El host del proxy no es válido.');
  return host;
}

async function clientDetails(env: Env, rows?: any[]) {
  const clients = rows || (await sb(env, 'userflex_clients?select=id,name,email,phone,status,max_devices,allow_external_browsing,created_at,updated_at&order=created_at.desc'));
  if (!clients?.length) return [];

  const ids = clients.map((client: any) => client.id).join(',');
  const credentials = await sb(env, `userflex_client_credentials?select=client_id,username&client_id=in.(${ids})`);
  const subscriptions = await sb(env, `userflex_subscriptions?select=id,client_id,plan_id,starts_at,expires_at,status,offline_grace_minutes,created_at,updated_at&client_id=in.(${ids})&order=created_at.desc`);
  const planIds = [...new Set((subscriptions || []).map((subscription: any) => subscription.plan_id))];
  const plans = planIds.length
    ? await sb(env, `userflex_plans?select=id,name,duration_days,max_profiles,enabled,created_at,updated_at&id=in.(${planIds.join(',')})`)
    : [];
  const plansById = new Map(plans.map((plan: any) => [plan.id, plan]));

  return clients.map((client: any) => {
    const credential = credentials.find((item: any) => item.client_id === client.id);
    const subscription =
      subscriptions.find((item: any) => item.client_id === client.id && item.status === 'active') ||
      subscriptions.find((item: any) => item.client_id === client.id) ||
      null;

    return {
      ...client,
      credential: credential ? { username: credential.username, has_password: true } : null,
      subscription: subscription ? { ...subscription, plan: plansById.get(subscription.plan_id) || null } : null,
    };
  });
}

function safeProxy(proxy: any) {
  return {
    id: proxy.id,
    name: proxy.name,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username || null,
    enabled: proxy.enabled === true,
    has_password: Boolean(proxy.password_ciphertext),
    created_at: proxy.created_at,
    updated_at: proxy.updated_at,
  };
}

async function assignmentResponse(env: Env, id: string) {
  const rows = await sb(env, `userflex_assignments?select=id,client_id,profile_id,proxy_id,enabled,created_at,updated_at&id=eq.${id}&limit=1`);
  return rows?.[0] || null;
}

export async function adminRoutes(request: Request, env: Env, admin: AdminIdentity): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/dashboard' && method === 'GET') {
    const [clients, plans, profiles, proxies, devices, assignments] = await Promise.all([
      sb(env, 'userflex_clients?select=id,status'),
      sb(env, 'userflex_plans?select=id'),
      sb(env, 'userflex_profiles?select=id'),
      sb(env, 'userflex_proxies?select=id'),
      sb(env, 'userflex_devices?select=id,status'),
      sb(env, 'userflex_assignments?select=id'),
    ]);
    return json({
      clients: clients.length,
      activeClients: clients.filter((client: any) => client.status === 'active').length,
      plans: plans.length,
      profiles: profiles.length,
      proxies: proxies.length,
      devices: devices.length,
      activeDevices: devices.filter((device: any) => device.status === 'active').length,
      assignments: assignments.length,
    });
  }

  if (path === '/api/clients' && method === 'GET') return json(await clientDetails(env));

  if (path === '/api/clients' && method === 'POST') {
    const body = await bodyJson(request);
    const name = text(body.name, 'name', 120);
    const email = text(body.email, 'email', 200).toLowerCase();
    const phone = optional(body.phone, 40);
    const maxDevices = integer(body.maxDevices ?? 1, 1, 50, 'maxDevices');
    const planId = uuid(body.planId, 'planId');
    const username = text(body.username, 'username', 80).toLowerCase();
    const startsAt = iso(body.startsAt, 'startsAt');
    const expiresAt = iso(body.expiresAt, 'expiresAt');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'INVALID_EMAIL');
    if (new Date(expiresAt) <= new Date(startsAt)) throw new HttpError(400, 'INVALID_SUBSCRIPTION_RANGE');

    const passwordHashValue = await passwordHash(typeof body.password === 'string' ? body.password : '');
    const result = await sb(env, 'rpc/userflex_create_client', {
      method: 'POST',
      body: JSON.stringify({
        p_name: name,
        p_email: email,
        p_phone: phone,
        p_plan_id: planId,
        p_username: username,
        p_password_hash: passwordHashValue,
        p_starts_at: startsAt,
        p_expires_at: expiresAt,
      }),
    });
    const id = Array.isArray(result) ? result[0] : result;
    await sb(env, `userflex_clients?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ max_devices: maxDevices, updated_at: new Date().toISOString() }),
    });
    await audit(env, request, 'admin', admin.userId, 'client.create', 'client', String(id), { maxDevices });
    const rows = await sb(env, `userflex_clients?select=id,name,email,phone,status,max_devices,allow_external_browsing,created_at,updated_at&id=eq.${id}&limit=1`);
    return json((await clientDetails(env, rows))[0], 201);
  }

  const credentialsMatch = path.match(/^\/api\/clients\/([0-9a-f-]{36})\/credentials$/i);
  if (credentialsMatch && method === 'POST') {
    const clientId = uuid(credentialsMatch[1], 'clientId');
    const body = await bodyJson(request);
    const username = text(body.username, 'username', 80).toLowerCase();
    const passwordHashValue = await passwordHash(typeof body.password === 'string' ? body.password : '');
    await sb(env, 'userflex_client_credentials?on_conflict=client_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        client_id: clientId,
        username,
        password_hash: passwordHashValue,
        updated_at: new Date().toISOString(),
      }),
    });
    await sb(env, `userflex_client_sessions?client_id=eq.${clientId}&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    await closeOpenProfileUsageForClient(env, clientId, 'credentials_reset');
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'client.credentials.reset', 'client', clientId);
    return json({ ok: true, username });
  }

  const subscriptionMatch = path.match(/^\/api\/clients\/([0-9a-f-]{36})\/subscription$/i);
  if (subscriptionMatch && method === 'POST') {
    const clientId = uuid(subscriptionMatch[1], 'clientId');
    const body = await bodyJson(request);
    const planId = uuid(body.planId, 'planId');
    const startsAt = iso(body.startsAt, 'startsAt');
    const expiresAt = iso(body.expiresAt, 'expiresAt');
    if (new Date(expiresAt) <= new Date(startsAt)) throw new HttpError(400, 'INVALID_SUBSCRIPTION_RANGE');
    await sb(env, 'rpc/userflex_replace_subscription', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: clientId,
        p_plan_id: planId,
        p_starts_at: startsAt,
        p_expires_at: expiresAt,
      }),
    });
    await closeOpenProfileUsageForClient(env, clientId, 'subscription_changed');
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'client.subscription.update', 'client', clientId, { planId, expiresAt });
    return json({ ok: true });
  }

  const clientMatch = path.match(/^\/api\/clients\/([0-9a-f-]{36})$/i);
  if (clientMatch && method === 'PATCH') {
    const clientId = uuid(clientMatch[1], 'clientId');
    const body = await bodyJson(request);
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 120);
    if (body.email !== undefined) {
      patch.email = text(body.email, 'email', 200).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(patch.email)) throw new HttpError(400, 'INVALID_EMAIL');
    }
    if (body.phone !== undefined) patch.phone = optional(body.phone, 40);
    if (body.max_devices !== undefined) patch.max_devices = integer(body.max_devices, 1, 50, 'max_devices');
    if (body.allow_external_browsing !== undefined) patch.allow_external_browsing = Boolean(body.allow_external_browsing);
    if (body.status !== undefined) {
      if (!['active', 'suspended'].includes(body.status)) throw new HttpError(400, 'INVALID_STATUS');
      patch.status = body.status;
    }
    const rows = await sb(env, `userflex_clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!rows?.[0]) throw new HttpError(404, 'CLIENT_NOT_FOUND');
    if (patch.status === 'suspended') {
      await sb(env, `userflex_client_sessions?client_id=eq.${clientId}&revoked_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      await closeOpenProfileUsageForClient(env, clientId, 'client_suspended');
    }
    await audit(env, request, 'admin', admin.userId, 'client.update', 'client', clientId);
    return json((await clientDetails(env, rows))[0]);
  }

  if (clientMatch && method === 'DELETE') {
    const clientId = uuid(clientMatch[1], 'clientId');
    await closeOpenProfileUsageForClient(env, clientId, 'client_deleted');
    await sb(env, `userflex_clients?id=eq.${clientId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await audit(env, request, 'admin', admin.userId, 'client.delete', 'client', clientId);
    return json({ ok: true });
  }

  if (path === '/api/plans' && method === 'GET') {
    return json(await sb(env, 'userflex_plans?select=id,name,duration_days,max_profiles,enabled,created_at,updated_at&order=name.asc'));
  }

  if (path === '/api/plans' && method === 'POST') {
    const body = await bodyJson(request);
    const row = {
      name: text(body.name, 'name', 80),
      duration_days: body.duration_days === null ? null : integer(body.duration_days, 1, 3650, 'duration_days'),
      max_devices: integer(body.max_devices, 1, 50, 'max_devices'),
      max_profiles: integer(body.max_profiles, 1, 500, 'max_profiles'),
      enabled: body.enabled !== false,
    };
    const rows = await sb(env, 'userflex_plans', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    await audit(env, request, 'admin', admin.userId, 'plan.create', 'plan', rows[0].id);
    return json(rows[0], 201);
  }

  const planMatch = path.match(/^\/api\/plans\/([0-9a-f-]{36})$/i);
  if (planMatch && method === 'PATCH') {
    const planId = uuid(planMatch[1], 'planId');
    const body = await bodyJson(request);
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 80);
    if (body.duration_days !== undefined) patch.duration_days = body.duration_days === null ? null : integer(body.duration_days, 1, 3650, 'duration_days');
    if (body.max_devices !== undefined) patch.max_devices = integer(body.max_devices, 1, 50, 'max_devices');
    if (body.max_profiles !== undefined) patch.max_profiles = integer(body.max_profiles, 1, 500, 'max_profiles');
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    const rows = await sb(env, `userflex_plans?id=eq.${planId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!rows?.[0]) throw new HttpError(404, 'PLAN_NOT_FOUND');
    await touchPlanClients(env, [planId]);
    await audit(env, request, 'admin', admin.userId, 'plan.update', 'plan', planId);
    return json(rows[0]);
  }

  if (planMatch && method === 'DELETE') {
    const planId = uuid(planMatch[1], 'planId');
    const affectedClientIds = await clientIdsForPlans(env, [planId]);
    await sb(env, `userflex_plans?id=eq.${planId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await touchClientsConfig(env, affectedClientIds);
    await audit(env, request, 'admin', admin.userId, 'plan.delete', 'plan', planId);
    return json({ ok: true });
  }

  if (path === '/api/profiles' && method === 'GET') {
    return json(await sb(env, 'userflex_profiles?select=id,name,url,platform,image_url,tags,enabled,session_mode,session_ready,browser_engine,auth_strategy,storage_strategy,network_strategy,extension_strategy,created_at,updated_at&order=name.asc'));
  }

  if (path === '/api/profiles' && method === 'POST') {
    const body = await bodyJson(request);
    const runtime = runtimeDefaults(body);
    const row = {
      name: text(body.name, 'name', 100),
      url: httpsUrl(body.url, 'url'),
      platform: optional(body.platform, 80),
      image_url: httpsUrl(body.image_url, 'image_url', true),
      tags: cleanTags(body.tags),
      enabled: body.enabled !== false,
      ...runtime,
      session_ready: false,
    };
    const rows = await sb(env, 'userflex_profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    await audit(env, request, 'admin', admin.userId, 'profile.create', 'profile', rows[0].id);
    return json(rows[0], 201);
  }

  const profileMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})$/i);
  if (profileMatch && method === 'PATCH') {
    const profileId = uuid(profileMatch[1], 'profileId');
    const body = await bodyJson(request);
    const existingRows = await sb(
      env,
      `userflex_profiles?select=id,url,session_mode,session_ready,browser_engine,auth_strategy,storage_strategy,network_strategy,extension_strategy&id=eq.${profileId}&limit=1`,
    );
    const existing = existingRows?.[0];
    if (!existing) throw new HttpError(404, 'PROFILE_NOT_FOUND');

    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 100);
    if (body.url !== undefined) patch.url = httpsUrl(body.url, 'url');
    if (body.platform !== undefined) patch.platform = optional(body.platform, 80);
    if (body.image_url !== undefined) patch.image_url = httpsUrl(body.image_url, 'image_url', true);
    if (body.tags !== undefined) patch.tags = cleanTags(body.tags);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.browser_engine !== undefined) patch.browser_engine = profileChoice(body.browser_engine, BROWSER_ENGINES, 'chrome-native', 'INVALID_BROWSER_ENGINE');
    if (body.storage_strategy !== undefined) patch.storage_strategy = profileChoice(body.storage_strategy, STORAGE_STRATEGIES, 'local-persistent', 'INVALID_STORAGE_STRATEGY');
    if (body.network_strategy !== undefined) patch.network_strategy = profileChoice(body.network_strategy, NETWORK_STRATEGIES, 'auto', 'INVALID_NETWORK_STRATEGY');
    if (body.extension_strategy !== undefined) patch.extension_strategy = profileChoice(body.extension_strategy, EXTENSION_STRATEGIES, 'guard-only', 'INVALID_EXTENSION_STRATEGY');
    if (body.auth_strategy !== undefined) {
      patch.auth_strategy = profileChoice(body.auth_strategy, AUTH_STRATEGIES, 'manual', 'INVALID_AUTH_STRATEGY');
      patch.session_mode = patch.auth_strategy === 'manual' ? 'manual-login' : 'managed-first-party';
      if (patch.auth_strategy === 'manual' || patch.auth_strategy === 'credential-autofill') patch.session_ready = false;
    } else if (body.session_mode !== undefined) {
      if (!['manual-login', 'managed-first-party'].includes(body.session_mode)) throw new HttpError(400, 'INVALID_SESSION_MODE');
      patch.session_mode = body.session_mode;
      patch.auth_strategy = body.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual';
      if (body.session_mode === 'manual-login') patch.session_ready = false;
    }

    const next = { ...existing, ...patch };
    const previousRuntime = runtimeForProfile(existing);
    const nextRuntime = runtimeForProfile(next);
    const originChanged = patch.url !== undefined && !sameOrigin(existing.url, patch.url);
    const previousSnapshot = snapshotAuthentication(previousRuntime);
    const nextSnapshot = snapshotAuthentication(nextRuntime);
    const snapshotPolicyChanged = previousSnapshot !== nextSnapshot
      || (previousSnapshot && nextSnapshot && (
        previousRuntime.browserEngine !== nextRuntime.browserEngine
        || previousRuntime.networkStrategy !== nextRuntime.networkStrategy
      ));
    const invalidateSnapshot = originChanged || snapshotPolicyChanged;
    const clearCredentials = originChanged
      || (previousRuntime.authStrategy !== 'manual' && nextRuntime.authStrategy === 'manual');
    if (invalidateSnapshot) patch.session_ready = false;

    const rows = await sb(env, `userflex_profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!rows?.[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND');

    if (invalidateSnapshot) {
      await sb(env, `userflex_profile_sessions?profile_id=eq.${profileId}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
    if (clearCredentials) {
      // Never carry credentials into a different origin, and do not retain
      // managed secrets after the profile returns to fully manual auth.
      await sb(env, `userflex_profile_credentials?profile_id=eq.${profileId}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }

    await touchProfileClients(env, profileId);
    if (!invalidateSnapshot && nextSnapshot && rows[0]?.enabled !== false) {
      await requestKeeperChecks(env, [profileId], 'profile-update');
    }
    await audit(env, request, 'admin', admin.userId, 'profile.update', 'profile', profileId, {
      originChanged,
      snapshotInvalidated: invalidateSnapshot,
      credentialsCleared: clearCredentials,
    });
    return json(rows[0]);
  }

  if (profileMatch && method === 'DELETE') {
    const profileId = uuid(profileMatch[1], 'profileId');
    const affectedClientIds = await clientIdsForProfile(env, profileId);
    await sb(env, `userflex_profiles?id=eq.${profileId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await touchClientsConfig(env, affectedClientIds);
    await audit(env, request, 'admin', admin.userId, 'profile.delete', 'profile', profileId);
    return json({ ok: true });
  }

  if (path === '/api/proxies' && method === 'GET') {
    return json((await sb(env, 'userflex_proxies?select=id,name,host,port,username,password_ciphertext,enabled,created_at,updated_at&order=name.asc')).map(safeProxy));
  }

  if (path === '/api/proxies' && method === 'POST') {
    const body = await bodyJson(request);
    const row: any = {
      name: text(body.name, 'name', 100),
      host: proxyHost(body.host),
      port: integer(body.port, 1, 65535, 'port'),
      username: optional(body.username, 160),
      enabled: body.enabled !== false,
    };
    if (body.password) {
      const secret = await encryptProxy(env, text(body.password, 'password', 512));
      Object.assign(row, { password_ciphertext: secret.ciphertext, password_iv: secret.iv, key_version: secret.keyVersion });
    }
    const rows = await sb(env, 'userflex_proxies', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    await audit(env, request, 'admin', admin.userId, 'proxy.create', 'proxy', rows[0].id, { host: rows[0].host, port: rows[0].port, hasPassword: Boolean(rows[0].password_ciphertext) });
    return json(safeProxy(rows[0]), 201);
  }

  const proxyMatch = path.match(/^\/api\/proxies\/([0-9a-f-]{36})$/i);
  if (proxyMatch && method === 'PATCH') {
    const proxyId = uuid(proxyMatch[1], 'proxyId');
    const body = await bodyJson(request);
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 100);
    if (body.host !== undefined) patch.host = proxyHost(body.host);
    if (body.port !== undefined) patch.port = integer(body.port, 1, 65535, 'port');
    if (body.username !== undefined) patch.username = optional(body.username, 160);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.clearPassword === true) {
      patch.password_ciphertext = null;
      patch.password_iv = null;
      patch.key_version = null;
    } else if (typeof body.password === 'string' && body.password.length > 0) {
      const secret = await encryptProxy(env, text(body.password, 'password', 512));
      patch.password_ciphertext = secret.ciphertext;
      patch.password_iv = secret.iv;
      patch.key_version = secret.keyVersion;
    }
    const rows = await sb(env, `userflex_proxies?id=eq.${proxyId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!rows?.[0]) throw new HttpError(404, 'PROXY_NOT_FOUND');
    await touchProxyClients(env, proxyId);
    await audit(env, request, 'admin', admin.userId, 'proxy.update', 'proxy', proxyId, { host: rows[0].host, port: rows[0].port, hasPassword: Boolean(rows[0].password_ciphertext) });
    return json(safeProxy(rows[0]));
  }

  if (proxyMatch && method === 'DELETE') {
    const proxyId = uuid(proxyMatch[1], 'proxyId');
    const affectedClientIds = await clientIdsForProxy(env, proxyId);
    await sb(env, `userflex_proxies?id=eq.${proxyId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await touchClientsConfig(env, affectedClientIds);
    await audit(env, request, 'admin', admin.userId, 'proxy.delete', 'proxy', proxyId);
    return json({ ok: true });
  }

  if (path === '/api/assignments' && method === 'GET') {
    const rows = await sb(env, 'userflex_assignments?select=id,client_id,profile_id,proxy_id,enabled,created_at,updated_at&order=created_at.desc');
    const clientIds = [...new Set(rows.map((row: any) => row.client_id))];
    const profileIds = [...new Set(rows.map((row: any) => row.profile_id))];
    const proxyIds = [...new Set(rows.map((row: any) => row.proxy_id).filter(Boolean))];
    const [clients, profiles, proxies] = await Promise.all([
      clientIds.length ? sb(env, `userflex_clients?select=id,name,email&id=in.(${clientIds.join(',')})`) : [],
      profileIds.length ? sb(env, `userflex_profiles?select=id,name,url&id=in.(${profileIds.join(',')})`) : [],
      proxyIds.length ? sb(env, `userflex_proxies?select=id,name,host,port&id=in.(${proxyIds.join(',')})`) : [],
    ]);
    const clientsById = new Map(clients.map((item: any) => [item.id, item]));
    const profilesById = new Map(profiles.map((item: any) => [item.id, item]));
    const proxiesById = new Map(proxies.map((item: any) => [item.id, item]));
    return json(rows.map((row: any) => ({ ...row, client: clientsById.get(row.client_id), profile: profilesById.get(row.profile_id), proxy: row.proxy_id ? proxiesById.get(row.proxy_id) || null : null })));
  }

  if (path === '/api/assignments' && method === 'POST') {
    const body = await bodyJson(request);
    const clientId = uuid(body.clientId, 'clientId');
    const profileId = uuid(body.profileId, 'profileId');
    const proxyId = body.proxyId ? uuid(body.proxyId, 'proxyId') : null;
    const enabled = body.enabled !== false;
    const result = await sb(env, 'rpc/userflex_upsert_assignment', { method: 'POST', body: JSON.stringify({ p_client_id: clientId, p_profile_id: profileId, p_proxy_id: proxyId, p_enabled: enabled }) });
    const id = String(Array.isArray(result) ? result[0] : result);
    const row = await assignmentResponse(env, id);
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'assignment.upsert', 'assignment', id, { clientId, profileId, proxyAssigned: Boolean(proxyId), enabled });
    return json(row, 201);
  }

  const assignmentMatch = path.match(/^\/api\/assignments\/([0-9a-f-]{36})$/i);
  if (assignmentMatch && method === 'PATCH') {
    const assignmentId = uuid(assignmentMatch[1], 'assignmentId');
    const existingRows = await sb(env, `userflex_assignments?select=id,client_id,profile_id,proxy_id,enabled&id=eq.${assignmentId}&limit=1`);
    const existing = existingRows?.[0];
    if (!existing) throw new HttpError(404, 'ASSIGNMENT_NOT_FOUND');
    const body = await bodyJson(request);
    const proxyId = body.proxyId === undefined ? existing.proxy_id : body.proxyId ? uuid(body.proxyId, 'proxyId') : null;
    const enabled = body.enabled === undefined ? existing.enabled === true : Boolean(body.enabled);
    const result = await sb(env, 'rpc/userflex_upsert_assignment', { method: 'POST', body: JSON.stringify({ p_client_id: existing.client_id, p_profile_id: existing.profile_id, p_proxy_id: proxyId, p_enabled: enabled }) });
    const id = String(Array.isArray(result) ? result[0] : result);
    await touchClientConfig(env, existing.client_id);
    await audit(env, request, 'admin', admin.userId, 'assignment.update', 'assignment', id, { proxyAssigned: Boolean(proxyId), enabled });
    return json(await assignmentResponse(env, id));
  }

  if (assignmentMatch && method === 'DELETE') {
    const assignmentId = uuid(assignmentMatch[1], 'assignmentId');
    const existingRows = await sb(env, `userflex_assignments?select=client_id&id=eq.${assignmentId}&limit=1`);
    const existing = existingRows?.[0];
    await sb(env, `userflex_assignments?id=eq.${assignmentId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (existing?.client_id) await touchClientConfig(env, existing.client_id);
    await audit(env, request, 'admin', admin.userId, 'assignment.delete', 'assignment', assignmentId);
    return json({ ok: true });
  }

  if (path === '/api/devices' && method === 'GET') {
    const rows = await sb(env, 'userflex_devices?select=id,client_id,name,os,status,last_ip,last_seen_at,userflow_version,userflow_version_seen_at,created_at&order=last_seen_at.desc.nullslast');
    const clientIds = [...new Set(rows.map((row: any) => row.client_id))];
    const clients = clientIds.length ? await sb(env, `userflex_clients?select=id,name,email&id=in.(${clientIds.join(',')})`) : [];
    const clientsById = new Map(clients.map((item: any) => [item.id, item]));
    return json(rows.map((row: any) => ({ ...row, client: clientsById.get(row.client_id) })));
  }

  const revokeMatch = path.match(/^\/api\/devices\/([0-9a-f-]{36})\/revoke$/i);
  if (revokeMatch && method === 'POST') {
    const deviceId = uuid(revokeMatch[1], 'deviceId');
    const rows = await sb(env, `userflex_devices?id=eq.${deviceId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'revoked', updated_at: new Date().toISOString() }) });
    const device = rows?.[0];
    if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND');
    await sb(env, `userflex_client_sessions?device_id=eq.${device.id}&revoked_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    await closeOpenProfileUsageForDevice(env, device.id, 'device_revoked');
    await touchClientConfig(env, device.client_id);
    await audit(env, request, 'admin', admin.userId, 'device.revoke', 'device', device.id, { clientId: device.client_id });
    return json(device);
  }

  const reactivateMatch = path.match(/^\/api\/devices\/([0-9a-f-]{36})\/reactivate$/i);
  if (reactivateMatch && method === 'POST') {
    const deviceId = uuid(reactivateMatch[1], 'deviceId');
    const result = await sb(env, 'rpc/userflex_reactivate_device', { method: 'POST', body: JSON.stringify({ p_device_id: deviceId }) });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) throw new HttpError(404, 'DEVICE_NOT_FOUND');
    if (row.status === 'limit_reached') throw new HttpError(409, 'DEVICE_LIMIT_REACHED', 'El plan ya alcanzó el máximo de dispositivos.');
    if (row.status === 'subscription_inactive') throw new HttpError(409, 'SUBSCRIPTION_INACTIVE', 'El cliente no tiene una suscripción activa.');
    const rows = await sb(env, `userflex_devices?select=id,client_id,name,os,status,last_ip,last_seen_at,userflow_version,userflow_version_seen_at,created_at&id=eq.${deviceId}&limit=1`);
    if (rows?.[0]?.client_id) await touchClientConfig(env, rows[0].client_id);
    await audit(env, request, 'admin', admin.userId, 'device.reactivate', 'device', deviceId);
    return json(rows?.[0]);
  }

  if (path === '/api/audit' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    return json(await sb(env, `userflex_audit_logs?select=id,actor_type,actor_id,action,entity_type,entity_id,ip_hash,details,created_at&order=created_at.desc&limit=${limit}`));
  }

  throw new HttpError(404, 'NOT_FOUND');
}
