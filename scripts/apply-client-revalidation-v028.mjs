import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(path, 'utf8');
}

async function write(path, content) {
  await fs.writeFile(path, content, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(from, to);
}

async function patch(path, mutate) {
  const before = await read(path);
  const after = mutate(before);
  if (after === before) throw new Error(`${path}: patch made no changes`);
  await write(path, after);
}

await write('cloudflare/lib/client-revalidation.ts', `import { Env, sb } from './core';

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function touchClientConfig(env: Env, clientId: string): Promise<void> {
  await sb(env, \`userflex_clients?id=eq.\${clientId}\`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

export async function touchClientsConfig(env: Env, clientIds: string[]): Promise<void> {
  const ids = uniqueIds(clientIds);
  if (!ids.length) return;
  await sb(env, \`userflex_clients?id=in.(\${ids.join(',')})\`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

export async function touchPlanClients(env: Env, planIds: string[]): Promise<void> {
  const ids = uniqueIds(planIds);
  if (!ids.length) return;
  const rows = await sb(
    env,
    \`userflex_subscriptions?select=client_id&status=eq.active&plan_id=in.(\${ids.join(',')})\`,
  );
  await touchClientsConfig(env, (rows || []).map((row: any) => String(row.client_id)));
}

export async function touchProfileClients(env: Env, profileId: string): Promise<void> {
  const rows = await sb(
    env,
    \`userflex_plan_profiles?select=plan_id&profile_id=eq.\${profileId}\`,
  );
  await touchPlanClients(env, (rows || []).map((row: any) => String(row.plan_id)));
}
`);

await patch('cloudflare/lib/core.ts', (source) => replaceOnce(
  source,
  "export const CLIENT_SESSION_SECONDS = 12 * 60 * 60;",
  "export const CLIENT_SESSION_SECONDS = 24 * 60 * 60;",
  'core client session lifetime',
));

await patch('cloudflare/lib/auth.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    'export type ClientIdentity={clientId:string;deviceId:string;sessionId:string;plan:any;subscription:any};',
    'export type ClientIdentity={clientId:string;deviceId:string;sessionId:string;client:any;plan:any;subscription:any};',
    'ClientIdentity client config',
  );
  next = replaceOnce(
    next,
    'userflex_clients?select=id&id=eq.${session.client_id}&status=eq.active&limit=1',
    'userflex_clients?select=id,name,email,status,updated_at&id=eq.${session.client_id}&status=eq.active&limit=1',
    'requireClient client select',
  );
  next = replaceOnce(
    next,
    'return{clientId:session.client_id,deviceId:session.device_id,sessionId:session.id,plan,subscription}',
    'return{clientId:session.client_id,deviceId:session.device_id,sessionId:session.id,client:clients[0],plan,subscription}',
    'requireClient identity return',
  );
  next = replaceOnce(
    next,
    'userflex_clients?select=id,name,email,status&id=eq.${cred.client_id}&limit=1',
    'userflex_clients?select=id,name,email,status,updated_at&id=eq.${cred.client_id}&limit=1',
    'clientLogin client select',
  );
  next = replaceOnce(
    next,
    'client:{id:client.id,name:client.name,email:client.email},plan:{id:plan.id,name:plan.name}',
    'client:{id:client.id,name:client.name,email:client.email,configRevision:client.updated_at},plan:{id:plan.id,name:plan.name}',
    'clientLogin config revision response',
  );
  return next;
});

await patch('cloudflare/lib/client.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import { Env, HttpError, audit, decryptProxy, json, sb } from './core';",
    "import { CLIENT_SESSION_SECONDS, Env, HttpError, audit, decryptProxy, json, sb } from './core';",
    'client imports',
  );
  next = replaceOnce(
    next,
`    return json({
      ok: true,
      profiles: [],
      plan: { id: id.plan.id, name: id.plan.name },
      expiresAt: id.subscription.expires_at,
    });`,
`    return json({
      ok: true,
      profiles: [],
      client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at },
      configRevision: id.client.updated_at,
      plan: { id: id.plan.id, name: id.plan.name },
      expiresAt: id.subscription.expires_at,
    });`,
    'empty catalog config revision',
  );
  next = replaceOnce(
    next,
`  return json({
    ok: true,
    profiles: result,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
  });`,
`  return json({
    ok: true,
    profiles: result,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at },
    configRevision: id.client.updated_at,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
  });`,
    'catalog config revision',
  );
  next = replaceOnce(
    next,
`  return json({
    ok: true,
    lease: {`,
`  return json({
    ok: true,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at },
    configRevision: id.client.updated_at,
    lease: {`,
    'launch config revision',
  );
  next = replaceOnce(
    next,
`export async function clientHeartbeat(id: ClientIdentity) {
  return json({
    ok: true,
    active: true,
    revoke: false,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
    serverTime: new Date().toISOString(),
  });
}`,
`export async function clientHeartbeat(env: Env, id: ClientIdentity) {
  const sessionExpiresAt = new Date(Date.now() + CLIENT_SESSION_SECONDS * 1000).toISOString();
  await sb(env, \`userflex_client_sessions?id=eq.\${id.sessionId}\`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ expires_at: sessionExpiresAt, last_seen_at: new Date().toISOString() }),
  });
  return json({
    ok: true,
    active: true,
    revoke: false,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at },
    configRevision: id.client.updated_at,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
    sessionExpiresAt,
    serverTime: new Date().toISOString(),
  });
}`,
    'rolling client heartbeat',
  );
  return next;
});

await patch('cloudflare/worker.ts', (source) => {
  let next = source;
  next = replaceOnce(next, "const APP_VERSION = '1.2.2';", "const APP_VERSION = '1.2.3';", 'worker version');
  next = replaceOnce(
    next,
    "if (path === '/api/client/heartbeat' && method === 'POST') return clientHeartbeat(identity);",
    "if (path === '/api/client/heartbeat' && method === 'POST') return clientHeartbeat(env, identity);",
    'heartbeat env',
  );
  return next;
});

await patch('cloudflare/lib/admin.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import { AdminIdentity } from './auth';\n",
    "import { AdminIdentity } from './auth';\nimport { touchClientConfig, touchProfileClients } from './client-revalidation';\n",
    'admin revalidation imports',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_client_sessions?client_id=eq.\${clientId}&revoked_at=is.null\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    await audit(env, request, 'admin', admin.userId, 'client.credentials.reset', 'client', clientId);`,
`    await sb(env, \`userflex_client_sessions?client_id=eq.\${clientId}&revoked_at=is.null\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'client.credentials.reset', 'client', clientId);`,
    'credential reset revision',
  );
  next = replaceOnce(
    next,
`    await sb(env, 'rpc/userflex_replace_subscription', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: clientId,
        p_plan_id: planId,
        p_starts_at: startsAt,
        p_expires_at: expiresAt,
      }),
    });
    await audit(env, request, 'admin', admin.userId, 'client.subscription.update', 'client', clientId, { planId, expiresAt });`,
`    await sb(env, 'rpc/userflex_replace_subscription', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: clientId,
        p_plan_id: planId,
        p_starts_at: startsAt,
        p_expires_at: expiresAt,
      }),
    });
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'client.subscription.update', 'client', clientId, { planId, expiresAt });`,
    'subscription revision',
  );
  next = replaceOnce(
    next,
`    if (!rows?.[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND');
    await audit(env, request, 'admin', admin.userId, 'profile.update', 'profile', profileId);`,
`    if (!rows?.[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND');
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.update', 'profile', profileId);`,
    'profile update revision',
  );
  next = replaceOnce(
    next,
`  if (profileMatch && method === 'DELETE') {
    const profileId = uuid(profileMatch[1], 'profileId');
    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });`,
`  if (profileMatch && method === 'DELETE') {
    const profileId = uuid(profileMatch[1], 'profileId');
    await touchProfileClients(env, profileId);
    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });`,
    'profile delete revision',
  );
  next = replaceOnce(
    next,
`  if (assignmentMatch && method === 'DELETE') {
    const assignmentId = uuid(assignmentMatch[1], 'assignmentId');
    await sb(env, \`userflex_assignments?id=eq.\${assignmentId}\`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await audit(env, request, 'admin', admin.userId, 'assignment.delete', 'assignment', assignmentId);`,
`  if (assignmentMatch && method === 'DELETE') {
    const assignmentId = uuid(assignmentMatch[1], 'assignmentId');
    const existingRows = await sb(env, \`userflex_assignments?select=client_id&id=eq.\${assignmentId}&limit=1\`);
    const existing = existingRows?.[0];
    await sb(env, \`userflex_assignments?id=eq.\${assignmentId}\`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (existing?.client_id) await touchClientConfig(env, existing.client_id);
    await audit(env, request, 'admin', admin.userId, 'assignment.delete', 'assignment', assignmentId);`,
    'assignment delete revision',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_client_sessions?device_id=eq.\${device.id}&revoked_at=is.null\`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    await audit(env, request, 'admin', admin.userId, 'device.revoke', 'device', device.id, { clientId: device.client_id });`,
`    await sb(env, \`userflex_client_sessions?device_id=eq.\${device.id}&revoked_at=is.null\`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    await touchClientConfig(env, device.client_id);
    await audit(env, request, 'admin', admin.userId, 'device.revoke', 'device', device.id, { clientId: device.client_id });`,
    'device revoke revision',
  );
  next = replaceOnce(
    next,
`    const rows = await sb(env, \`userflex_devices?select=id,client_id,name,os,status,last_seen_at,created_at&id=eq.\${deviceId}&limit=1\`);
    await audit(env, request, 'admin', admin.userId, 'device.reactivate', 'device', deviceId);`,
`    const rows = await sb(env, \`userflex_devices?select=id,client_id,name,os,status,last_seen_at,created_at&id=eq.\${deviceId}&limit=1\`);
    if (rows?.[0]?.client_id) await touchClientConfig(env, rows[0].client_id);
    await audit(env, request, 'admin', admin.userId, 'device.reactivate', 'device', deviceId);`,
    'device reactivate revision',
  );
  return next;
});

await patch('cloudflare/lib/plan-access.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import { AdminIdentity } from './auth';\n",
    "import { AdminIdentity } from './auth';\nimport { touchClientConfig, touchPlanClients } from './client-revalidation';\n",
    'plan access revalidation imports',
  );
  next = replaceOnce(
    next,
`    if (!rows?.[0]) throw new HttpError(404, 'PLAN_NOT_FOUND');
    if (profileIds) await replacePlanProfiles(env, planId, profileIds);
    const detailed = (await planDetails(env, rows))[0];`,
`    if (!rows?.[0]) throw new HttpError(404, 'PLAN_NOT_FOUND');
    if (profileIds) await replacePlanProfiles(env, planId, profileIds);
    await touchPlanClients(env, [planId]);
    const detailed = (await planDetails(env, rows))[0];`,
    'plan update revisions',
  );
  next = replaceOnce(
    next,
`    const id = String(Array.isArray(result) ? result[0] : result);
    await audit(env, request, 'admin', admin.userId, 'assignment.upsert', 'assignment', id, {`,
`    const id = String(Array.isArray(result) ? result[0] : result);
    await touchClientConfig(env, clientId);
    await audit(env, request, 'admin', admin.userId, 'assignment.upsert', 'assignment', id, {`,
    'assignment upsert revision',
  );
  next = replaceOnce(
    next,
`    const id = String(Array.isArray(result) ? result[0] : result);
    await audit(env, request, 'admin', admin.userId, 'assignment.update', 'assignment', id, {`,
`    const id = String(Array.isArray(result) ? result[0] : result);
    await touchClientConfig(env, existing.client_id);
    await audit(env, request, 'admin', admin.userId, 'assignment.update', 'assignment', id, {`,
    'assignment update revision',
  );
  return next;
});

await patch('cloudflare/lib/profile-plan-access.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import { AdminIdentity } from './auth';\n",
    "import { AdminIdentity } from './auth';\nimport { touchPlanClients } from './client-revalidation';\n",
    'profile plan revalidation import',
  );
  next = replaceOnce(
    next,
`  await Promise.all(
    affectedPlanIds.map(async (planId) => {
      await syncPlanProfileCount(env, planId);
      await sb(env, 'rpc/userflex_disable_disallowed_assignments', {
        method: 'POST',
        body: JSON.stringify({ p_plan_id: planId }),
      });
    }),
  );
}`,
`  await Promise.all(
    affectedPlanIds.map(async (planId) => {
      await syncPlanProfileCount(env, planId);
      await sb(env, 'rpc/userflex_disable_disallowed_assignments', {
        method: 'POST',
        body: JSON.stringify({ p_plan_id: planId }),
      });
    }),
  );
  return affectedPlanIds;
}`,
    'profile plan affected ids',
  );
  next = replaceOnce(
    next,
`    await replaceProfilePlans(env, profileId, planIds);
    await audit(env, request, 'admin', admin.userId, 'profile.plans.update', 'profile', profileId, {`,
`    const affectedPlanIds = await replaceProfilePlans(env, profileId, planIds);
    await touchPlanClients(env, affectedPlanIds);
    await audit(env, request, 'admin', admin.userId, 'profile.plans.update', 'profile', profileId, {`,
    'profile plan client revisions',
  );
  return next;
});

await patch('cloudflare/lib/profile-proxy-defaults.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import type { AdminIdentity } from './auth';\n",
    "import type { AdminIdentity } from './auth';\nimport { touchProfileClients } from './client-revalidation';\n",
    'profile proxy revalidation import',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_profile_proxy_defaults?profile_id=eq.\${profileId}\`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.clear', 'profile', profileId);`,
`    await sb(env, \`userflex_profile_proxy_defaults?profile_id=eq.\${profileId}\`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.clear', 'profile', profileId);`,
    'profile proxy clear revision',
  );
  next = replaceOnce(
    next,
`  await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.set', 'profile', profileId, {
    proxyId,
  });`,
`  await touchProfileClients(env, profileId);
  await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.set', 'profile', profileId, {
    proxyId,
  });`,
    'profile proxy set revision',
  );
  return next;
});

await patch('cloudflare/lib/profile-sessions.ts', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "import { AdminIdentity } from './auth';\n",
    "import { AdminIdentity } from './auth';\nimport { touchProfileClients } from './client-revalidation';\n",
    'profile session revalidation import',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_mode: 'managed-first-party', updated_at: new Date().toISOString() }),
    });
    await audit(env, request, 'admin', admin.userId, 'profile.credentials.update', 'profile', profileId, {`,
`    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_mode: 'managed-first-party', updated_at: new Date().toISOString() }),
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.credentials.update', 'profile', profileId, {`,
    'managed credentials revision',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_ready: false, updated_at: new Date().toISOString() }),
    });
    await audit(env, request, 'admin', admin.userId, 'profile.session.clear', 'profile', profileId);`,
`    await sb(env, \`userflex_profiles?id=eq.\${profileId}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ session_ready: false, updated_at: new Date().toISOString() }),
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.session.clear', 'profile', profileId);`,
    'session clear revision',
  );
  next = replaceOnce(
    next,
`    await sb(env, \`userflex_profile_session_jobs?id=eq.\${job.id}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'completed', used_at: now }),
    });
    return json({ ok: true, profile_id: job.profile_id, version, public_ip: publicIp });`,
`    await sb(env, \`userflex_profile_session_jobs?id=eq.\${job.id}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'completed', used_at: now }),
    });
    await touchProfileClients(env, job.profile_id);
    return json({ ok: true, profile_id: job.profile_id, version, public_ip: publicIp });`,
    'session capture completion revision',
  );
  return next;
});

await patch('client-app/main.js', (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "const HEARTBEAT_MS = 60_000;",
    "const HEARTBEAT_MS = 12 * 60 * 60 * 1000;",
    '12 hour heartbeat interval',
  );
  next = replaceOnce(
    next,
    "  return error?.status === 401 || ['CLIENT_UNAUTHENTICATED', 'CLIENT_SUSPENDED', 'DEVICE_REVOKED', 'SUBSCRIPTION_INACTIVE'].includes(error?.code);",
    "  return error?.status === 401 || ['CLIENT_UNAUTHENTICATED', 'CLIENT_SUSPENDED', 'DEVICE_REVOKED', 'SUBSCRIPTION_INACTIVE', 'PLAN_INACTIVE'].includes(error?.code);",
    'plan inactive auth invalidation',
  );
  next = replaceOnce(
    next,
`function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!accessToken) return;
    try {
      const result = await apiRequest('/api/client/heartbeat', { method: 'POST' });
      sendClient('userflex:heartbeat', result);
      if (result?.revoke === true || result?.active === false) await returnToLogin();
    } catch (error) {
      if (authError(error)) await returnToLogin();
    }
  }, HEARTBEAT_MS);
}`,
`function configRevisionFrom(payload) {
  return payload?.configRevision || payload?.client?.configRevision || null;
}

function mergeValidationMeta(payload) {
  if (!payload || typeof payload !== 'object') return;
  authMeta = authMeta || {};
  if (payload.client) authMeta.client = { ...(authMeta.client || {}), ...payload.client };
  const revision = configRevisionFrom(payload);
  if (revision) authMeta.client = { ...(authMeta.client || {}), configRevision: revision };
  if (payload.plan) authMeta.plan = { ...(authMeta.plan || {}), ...payload.plan };
  if (payload.expiresAt) authMeta.subscription = { ...(authMeta.subscription || {}), expiresAt: payload.expiresAt };
  if (payload.sessionExpiresAt) authMeta.expiresAt = payload.sessionExpiresAt;
}

async function syncClientConfiguration(payload, reason = 'server', knownCatalog = null) {
  const previousRevision = authMeta?.client?.configRevision || null;
  const nextRevision = configRevisionFrom(payload);
  const configChanged = Boolean(previousRevision && nextRevision && previousRevision !== nextRevision);
  mergeValidationMeta(payload);
  let freshCatalog = knownCatalog;
  if (configChanged && !freshCatalog) freshCatalog = await catalog();
  if (freshCatalog) mergeValidationMeta(freshCatalog);
  if (accessToken && authMeta) await saveAuth(accessToken, authMeta).catch(() => null);
  return { configChanged, catalog: freshCatalog, auth: authMeta, validationReason: reason };
}

async function runHeartbeat(reason = 'scheduled') {
  if (!accessToken) return;
  try {
    const result = await apiRequest('/api/client/heartbeat', { method: 'POST' });
    if (result?.revoke === true || result?.active === false) {
      await returnToLogin();
      return;
    }
    const sync = await syncClientConfiguration(result, reason);
    sendClient('userflex:heartbeat', { ...result, ...sync });
  } catch (error) {
    if (authError(error)) await returnToLogin();
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => void runHeartbeat('12h'), HEARTBEAT_MS);
}`,
    'heartbeat revalidation logic',
  );
  next = replaceOnce(
    next,
`  const launch = await apiRequest(\`/api/client/profiles/\${profileId}/launch\`, { method: 'POST' });
  const profile = launch?.profile;`,
`  const launch = await apiRequest(\`/api/client/profiles/\${profileId}/launch\`, { method: 'POST' });
  const sync = await syncClientConfiguration(launch, 'profile-launch');
  if (sync.configChanged && sync.catalog) {
    sendClient('userflex:heartbeat', { active: true, revoke: false, ...sync });
  }
  const profile = launch?.profile;`,
    'profile launch config sync',
  );
  next = replaceOnce(
    next,
`    const data = await catalog();
    startHeartbeat();
    enterWorkspace(event.sender);
    return { authenticated: true, auth: authMeta, catalog: data };`,
`    const data = await catalog();
    await syncClientConfiguration(data, 'bootstrap', data);
    startHeartbeat();
    enterWorkspace(event.sender);
    return { authenticated: true, auth: authMeta, catalog: data };`,
    'bootstrap config sync',
  );
  next = replaceOnce(
    next,
`    await saveAuth(result.accessToken, meta);
    const data = await catalog();
    startHeartbeat();
    enterWorkspace(event.sender);
    return { ok: true, auth: meta, catalog: data };`,
`    await saveAuth(result.accessToken, meta);
    const data = await catalog();
    await syncClientConfiguration(data, 'login', data);
    startHeartbeat();
    enterWorkspace(event.sender);
    return { ok: true, auth: authMeta, catalog: data };`,
    'login config sync',
  );
  next = replaceOnce(
    next,
`  try {
    const data = await catalog();
    return { ok: true, catalog: data, auth: authMeta };
  } catch (error) {`,
`  try {
    const data = await catalog();
    await syncClientConfiguration(data, 'catalog', data);
    return { ok: true, catalog: data, auth: authMeta };
  } catch (error) {`,
    'catalog config sync',
  );
  next = replaceOnce(
    next,
`  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex-browser:get-state', (event) => {`,
`  } catch (error) {
    if (error?.code === 'PROFILE_NOT_INCLUDED_IN_PLAN') {
      try {
        const data = await catalog();
        const sync = await syncClientConfiguration(data, 'profile-rejected', data);
        sendClient('userflex:heartbeat', { active: true, revoke: false, ...sync, configChanged: true });
      } catch {}
    }
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex-browser:get-state', (event) => {`,
    'profile rejection refresh',
  );
  return next;
});

await patch('client-app/renderer.js', (source) => replaceOnce(
  source,
`window.userflex.onHeartbeat((payload) => {
  serverState.textContent = payload?.active === false ? 'Sin autorización' : 'Conectado';
  serverState.classList.toggle('bad', payload?.active === false);
  heartbeatTime.textContent = \`Última conexión \${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}\`;
});`,
`window.userflex.onHeartbeat((payload) => {
  if (payload?.auth) auth = payload.auth;
  if (payload?.catalog) {
    catalog = payload.catalog;
    renderClient();
  } else {
    renderAccount();
  }
  serverState.textContent = payload?.active === false ? 'Sin autorización' : 'Conectado';
  serverState.classList.toggle('bad', payload?.active === false);
  const stamp = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  heartbeatTime.textContent = payload?.configChanged ? \`Configuración actualizada \${stamp}\` : \`Última conexión \${stamp}\`;
});`,
  'renderer config refresh',
));

await patch('client-app/package.json', (source) => replaceOnce(
  source,
  '"version": "0.2.27"',
  '"version": "0.2.28"',
  'client version',
));

await patch('client-app/index.html', (source) => {
  const count = source.split('v0.2.27').length - 1;
  if (count < 1) throw new Error(`index version: expected at least one match, found ${count}`);
  return source.replaceAll('v0.2.27', 'v0.2.28');
});

console.log('Applied userFLOW v0.2.28 12-hour heartbeat and config revalidation changes.');
