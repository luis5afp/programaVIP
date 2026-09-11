import { ClientIdentity } from './auth';
import { Env, HttpError, audit, decryptProxy, json, sb } from './core';

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
  const [profiles, defaults] = await Promise.all([
    sb(
      env,
      `userflex_profiles?select=id,name,url,platform,image_url,tags,enabled,session_mode,session_ready&id=in.(${ids})&enabled=eq.true`,
    ),
    sb(
      env,
      `userflex_profile_proxy_defaults?select=profile_id,proxy_id&profile_id=in.(${ids})`,
    ),
  ]);

  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const defaultProxyMap = new Map((defaults || []).map((row: any) => [row.profile_id, row.proxy_id]));
  const result = limited
    .map((assignment: any) => {
      const profile: any = profileMap.get(assignment.profile_id);
      if (!profile) return null;
      return {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        platform: profile.platform,
        imageUrl: profile.image_url,
        tags: profile.tags || [],
        managedConnection: Boolean(assignment.proxy_id || defaultProxyMap.get(assignment.profile_id)),
        sessionMode: profile.session_mode,
        sessionReady: profile.session_ready === true,
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

  const defaultProxyId = defaults?.[0]?.proxy_id || null;
  const effectiveProxyId = assignment.proxy_id || defaultProxyId;
  const proxySource = assignment.proxy_id ? 'assignment' : defaultProxyId ? 'profile' : 'direct';
  let connection: any = { mode: 'direct' };

  if (effectiveProxyId) {
    const rows = await sb(
      env,
      `userflex_proxies?select=id,host,port,username,password_ciphertext,password_iv&enabled=eq.true&id=eq.${effectiveProxyId}&limit=1`,
    );
    const proxy = rows?.[0];
    if (proxy) {
      connection = {
        mode: 'proxy',
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

  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {
    deviceId: id.deviceId,
    usesProxy: connection.mode === 'proxy',
    proxySource,
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
    sessionDelivery: {
      ready: profile.session_ready === true,
      mode: profile.session_mode,
      materialIncluded: false,
    },
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
