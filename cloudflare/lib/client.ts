import { ClientIdentity } from './auth';
import { CLIENT_SESSION_SECONDS, Env, HttpError, audit, decryptProxy, json, sb } from './core';
import { managedSessionMaterial } from './profile-sessions';
import { closeOpenProfileUsageForSession, openProfileUsage } from './profile-usage';

function inetHost(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return raw.split('/')[0] || null;
}

export async function clientCatalog(env: Env, id: ClientIdentity) {
  const memberships = await sb(
    env,
    `userflex_plan_profiles?select=profile_id&plan_id=eq.${id.plan.id}&order=created_at.asc`,
  );
  if (!memberships?.length) {
    return json({
      ok: true,
      profiles: [],
      client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
      configRevision: id.client.updated_at,
      plan: { id: id.plan.id, name: id.plan.name },
      expiresAt: id.subscription.expires_at,
    });
  }

  const profileIds = memberships.map((membership: any) => membership.profile_id);
  const ids = profileIds.join(',');
  const [profiles, defaults, sessions, assignments] = await Promise.all([
    sb(
      env,
      `userflex_profiles?select=id,name,url,platform,image_url,tags,enabled,session_mode,session_ready&id=in.(${ids})&enabled=eq.true`,
    ),
    sb(
      env,
      `userflex_profile_proxy_defaults?select=profile_id,proxy_id&profile_id=in.(${ids})`,
    ),
    sb(
      env,
      `userflex_profile_sessions?select=profile_id,session_version,status,expected_egress_ip&profile_id=in.(${ids})`,
    ),
    sb(
      env,
      `userflex_assignments?select=profile_id,proxy_id&client_id=eq.${id.clientId}&profile_id=in.(${ids})&enabled=eq.true`,
    ),
  ]);

  const proxyIds = [...new Set([
    ...(defaults || []).map((row: any) => String(row.proxy_id || '')).filter(Boolean),
    ...(assignments || []).map((row: any) => String(row.proxy_id || '')).filter(Boolean),
  ])];
  const proxyRows = proxyIds.length
    ? await sb(
        env,
        `userflex_proxies?select=id,proxy_type,validation_status,public_ip&id=in.(${proxyIds.join(',')})`,
      )
    : [];

  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const defaultProxyMap = new Map((defaults || []).map((row: any) => [row.profile_id, row.proxy_id]));
  const sessionMap = new Map((sessions || []).map((row: any) => [row.profile_id, row]));
  const assignmentMap = new Map((assignments || []).map((row: any) => [row.profile_id, row]));
  const proxyMap = new Map((proxyRows || []).map((row: any) => [row.id, row]));
  const result = profileIds
    .map((profileId: string) => {
      const profile: any = profileMap.get(profileId);
      if (!profile) return null;
      const managed = profile.session_mode === 'managed-first-party';
      const session: any = sessionMap.get(profile.id);
      const assignment: any = assignmentMap.get(profile.id);
      const assignmentProxyId = assignment?.proxy_id || null;
      const profileProxyId = defaultProxyMap.get(profile.id) || null;
      const profileProxy: any = profileProxyId ? proxyMap.get(profileProxyId) : null;
      const currentPublicIp = inetHost(profileProxy?.public_ip) || session?.expected_egress_ip || null;
      return {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        platform: profile.platform,
        imageUrl: profile.image_url,
        tags: profile.tags || [],
        managedConnection: managed
          ? Boolean(profileProxyId)
          : Boolean(assignmentProxyId || profileProxyId),
        sessionMode: profile.session_mode,
        sessionReady: profile.session_ready === true && (!managed || session?.status === 'ready'),
        sessionVersion: Number(session?.session_version || 0),
        networkIdentity: managed
          ? {
              locked: Boolean(profileProxyId),
              publicIp: profileProxyId ? currentPublicIp : null,
              proxyType: profileProxy?.proxy_type || null,
              proxyStatus: profileProxy?.validation_status || null,
            }
          : { locked: false, publicIp: null },
      };
    })
    .filter(Boolean);

  return json({
    ok: true,
    profiles: result,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
    configRevision: id.client.updated_at,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
  });
}

export async function clientLaunch(
  request: Request,
  env: Env,
  id: ClientIdentity,
  profileId: string,
) {
  const [memberships, assignments, profiles, defaults] = await Promise.all([
    sb(
      env,
      `userflex_plan_profiles?select=profile_id&plan_id=eq.${id.plan.id}&profile_id=eq.${profileId}&limit=1`,
    ),
    sb(
      env,
      `userflex_assignments?select=id,proxy_id&client_id=eq.${id.clientId}&profile_id=eq.${profileId}&enabled=eq.true&limit=1`,
    ),
    sb(
      env,
      `userflex_profiles?select=id,name,url,platform,image_url,tags,session_mode,session_ready&id=eq.${profileId}&enabled=eq.true&limit=1`,
    ),
    sb(
      env,
      `userflex_profile_proxy_defaults?select=proxy_id&profile_id=eq.${profileId}&limit=1`,
    ),
  ]);
  if (!memberships?.[0]) {
    throw new HttpError(403, 'PROFILE_NOT_INCLUDED_IN_PLAN', 'Este perfil no está incluido en tu plan activo.');
  }

  const assignment = assignments?.[0] || null;
  const profile = profiles?.[0];
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND');

  const managed = profile.session_mode === 'managed-first-party';
  const defaultProxyId = defaults?.[0]?.proxy_id || null;
  const assignmentProxyId = assignment?.proxy_id || null;
  const effectiveProxyId = managed ? defaultProxyId : (assignmentProxyId || defaultProxyId);
  const proxySource = managed
    ? (defaultProxyId ? 'profile-locked' : 'direct')
    : assignmentProxyId ? 'assignment' : defaultProxyId ? 'profile' : 'direct';
  let connection: any = { mode: 'direct', locked: false };
  let effectiveProxy: any = null;

  if (effectiveProxyId) {
    const rows = await sb(
      env,
      `userflex_proxies?select=id,host,port,username,password_ciphertext,password_iv,proxy_type,validation_status,public_ip&enabled=eq.true&id=eq.${effectiveProxyId}&limit=1`,
    );
    const proxy = rows?.[0];
    if (!proxy && managed && defaultProxyId) {
      throw new HttpError(409, 'MANAGED_PROXY_UNAVAILABLE', 'El proxy del perfil no está disponible. Se bloqueó la salida directa para proteger la IP.');
    }
    if (proxy) {
      effectiveProxy = proxy;
      if (proxy.proxy_type === 'ssh') {
        throw new HttpError(409, 'PROXY_PROTOCOL_UNSUPPORTED', 'El proxy SSH necesita un túnel local y todavía no puede usarse directamente en userFLOW.');
      }
      connection = {
        mode: 'proxy',
        locked: managed,
        proxy: {
          host: proxy.host,
          port: proxy.port,
          type: proxy.proxy_type || 'http',
          validationStatus: proxy.validation_status || null,
          publicIp: inetHost(proxy.public_ip),
          username: proxy.username || null,
          password: proxy.password_ciphertext
            ? await decryptProxy(env, proxy.password_ciphertext, proxy.password_iv)
            : null,
        },
      };
    }
  }

  let sessionDelivery: any = {
    ready: profile.session_ready === true,
    mode: profile.session_mode,
    materialIncluded: false,
  };

  if (managed) {
    const session = await managedSessionMaterial(env, profileId);
    if (!session || profile.session_ready !== true) {
      throw new HttpError(409, 'MANAGED_SESSION_NOT_READY', 'La sesión administrada todavía no está lista.');
    }
    const lockedNetwork = connection.mode === 'proxy' && defaultProxyId !== null;
    const currentProxyIp = lockedNetwork ? inetHost(effectiveProxy?.public_ip) : null;
    sessionDelivery = {
      ready: true,
      mode: profile.session_mode,
      materialIncluded: true,
      version: session.version,
      expectedPublicIp: lockedNetwork ? (currentProxyIp || session.publicIp) : null,
      networkLocked: lockedNetwork,
      capturedAt: session.capturedAt,
      validatedAt: session.validatedAt,
      material: session.material,
    };
  }

  const usage = await openProfileUsage(request, env, id, { id: profile.id, name: profile.name, url: profile.url });

  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {
    deviceId: id.deviceId,
    usesProxy: connection.mode === 'proxy',
    proxySource,
    proxyType: connection.proxy?.type || null,
    managed,
    networkLocked: connection.locked === true,
    sessionVersion: sessionDelivery.version || 0,
  });

  return json({
    ok: true,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
    configRevision: id.client.updated_at,
    lease: {
      expiresAt: id.subscription.expires_at,
      serverTime: new Date().toISOString(),
    },
    profile: {
      id: profile.id,
      name: profile.name,
      url: profile.url,
      platform: profile.platform,
      imageUrl: profile.image_url,
      tags: profile.tags || [],
      sessionMode: profile.session_mode,
      sessionReady: profile.session_ready === true,
    },
    connection,
    sessionDelivery,
    usage,
  });
}

export async function clientHeartbeat(env: Env, id: ClientIdentity) {
  const sessionExpiresAt = new Date(Date.now() + CLIENT_SESSION_SECONDS * 1000).toISOString();
  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ expires_at: sessionExpiresAt, last_seen_at: new Date().toISOString() }),
  });
  return json({
    ok: true,
    active: true,
    revoke: false,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
    configRevision: id.client.updated_at,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
    sessionExpiresAt,
    serverTime: new Date().toISOString(),
  });
}

export async function clientLogout(env: Env, id: ClientIdentity) {
  await closeOpenProfileUsageForSession(env, id.sessionId, 'logout');
  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return json({ ok: true });
}
