import { ClientIdentity } from './auth';
import { Env, HttpError, audit, decryptProxy, json, sb } from './core';
import { managedSessionMaterial } from './profile-sessions';

export async function clientCatalog(env: Env, id: ClientIdentity) {
  const assignments = await sb(
    env,
    `userflex_assignments?select=id,profile_id,proxy_id&client_id=eq.${id.clientId}&enabled=eq.true&order=created_at.asc`,
  );
  if (!assignments?.length) {
    return json({
      ok: true,
      profiles: [],
      plan: { id: id.plan.id, name: id.plan.name },
      expiresAt: id.subscription.expires_at,
    });
  }

  const limited = assignments.slice(0, id.plan.max_profiles);
  const profileIds = limited.map((assignment: any) => assignment.profile_id);
  const ids = profileIds.join(',');
  const [profiles, defaults, sessions] = await Promise.all([
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
  ]);

  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const defaultProxyMap = new Map((defaults || []).map((row: any) => [row.profile_id, row.proxy_id]));
  const sessionMap = new Map((sessions || []).map((row: any) => [row.profile_id, row]));
  const result = limited
    .map((assignment: any) => {
      const profile: any = profileMap.get(assignment.profile_id);
      if (!profile) return null;
      const managed = profile.session_mode === 'managed-first-party';
      const session: any = sessionMap.get(profile.id);
      return {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        platform: profile.platform,
        imageUrl: profile.image_url,
        tags: profile.tags || [],
        managedConnection: managed
          ? Boolean(defaultProxyMap.get(profile.id))
          : Boolean(assignment.proxy_id || defaultProxyMap.get(profile.id)),
        sessionMode: profile.session_mode,
        sessionReady: profile.session_ready === true && (!managed || session?.status === 'ready'),
        sessionVersion: Number(session?.session_version || 0),
        networkIdentity: managed
          ? { locked: true, publicIp: session?.expected_egress_ip || null }
          : { locked: false, publicIp: null },
      };
    })
    .filter(Boolean);

  return json({
    ok: true,
    profiles: result,
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
  const assignments = await sb(
    env,
    `userflex_assignments?select=id,proxy_id&client_id=eq.${id.clientId}&profile_id=eq.${profileId}&enabled=eq.true&limit=1`,
  );
  const assignment = assignments?.[0];
  if (!assignment) throw new HttpError(403, 'PROFILE_NOT_ASSIGNED');

  const [profiles, defaults] = await Promise.all([
    sb(
      env,
      `userflex_profiles?select=id,name,url,platform,image_url,tags,session_mode,session_ready&id=eq.${profileId}&enabled=eq.true&limit=1`,
    ),
    sb(
      env,
      `userflex_profile_proxy_defaults?select=proxy_id&profile_id=eq.${profileId}&limit=1`,
    ),
  ]);
  const profile = profiles?.[0];
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND');

  const managed = profile.session_mode === 'managed-first-party';
  const defaultProxyId = defaults?.[0]?.proxy_id || null;
  const effectiveProxyId = managed ? defaultProxyId : (assignment.proxy_id || defaultProxyId);
  const proxySource = managed ? 'profile-locked' : assignment.proxy_id ? 'assignment' : defaultProxyId ? 'profile' : 'direct';
  let connection: any = { mode: 'direct' };

  if (managed && !effectiveProxyId) {
    throw new HttpError(409, 'MANAGED_PROXY_REQUIRED', 'Este perfil requiere su proxy fijo para proteger la identidad de red.');
  }

  if (effectiveProxyId) {
    const rows = await sb(
      env,
      `userflex_proxies?select=id,host,port,username,password_ciphertext,password_iv&enabled=eq.true&id=eq.${effectiveProxyId}&limit=1`,
    );
    const proxy = rows?.[0];
    if (!proxy && managed) {
      throw new HttpError(409, 'MANAGED_PROXY_UNAVAILABLE', 'El proxy fijo del perfil no está disponible. Se bloqueó la salida directa.');
    }
    if (proxy) {
      connection = {
        mode: 'proxy',
        locked: managed,
        proxy: {
          host: proxy.host,
          port: proxy.port,
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
    if (connection.mode !== 'proxy') {
      throw new HttpError(409, 'MANAGED_NETWORK_LOCKED', 'No se permite conexión directa para este perfil.');
    }
    const session = await managedSessionMaterial(env, profileId);
    if (!session || profile.session_ready !== true) {
      throw new HttpError(409, 'MANAGED_SESSION_NOT_READY', 'La sesión administrada todavía no está lista.');
    }
    sessionDelivery = {
      ready: true,
      mode: profile.session_mode,
      materialIncluded: true,
      version: session.version,
      expectedPublicIp: session.publicIp,
      capturedAt: session.capturedAt,
      validatedAt: session.validatedAt,
      material: session.material,
    };
  }

  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {
    deviceId: id.deviceId,
    usesProxy: connection.mode === 'proxy',
    proxySource,
    managed,
    sessionVersion: sessionDelivery.version || 0,
  });

  return json({
    ok: true,
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
  });
}

export async function clientHeartbeat(id: ClientIdentity) {
  return json({
    ok: true,
    active: true,
    revoke: false,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
    serverTime: new Date().toISOString(),
  });
}

export async function clientLogout(env: Env, id: ClientIdentity) {
  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return json({ ok: true });
}
