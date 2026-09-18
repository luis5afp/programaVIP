import { ClientIdentity } from './auth';
import { CLIENT_SESSION_SECONDS, Env, HttpError, audit, decryptProxy, json, sb } from './core';
import { managedProfileCredentials, managedSessionMaterial } from './profile-sessions';
import { closeOpenProfileUsageForSession, openProfileUsage } from './profile-usage';

function inetHost(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return raw.split('/')[0] || null;
}

function runtimeFor(profile: any) {
  const authStrategy = profile?.auth_strategy
    || (profile?.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
  return {
    browserEngine: profile?.browser_engine || 'chrome-native',
    authStrategy,
    storageStrategy: profile?.storage_strategy
      || (authStrategy === 'manual' || authStrategy === 'credential-autofill' ? 'local-persistent' : 'portable-first-party'),
    networkStrategy: profile?.network_strategy || 'auto',
    extensionStrategy: profile?.extension_strategy || (authStrategy === 'manual' ? 'guard-only' : 'custom'),
  };
}

function needsSnapshot(runtime: any) {
  return runtime.authStrategy === 'cookie-snapshot' || runtime.authStrategy === 'hybrid';
}

function needsCredentials(runtime: any) {
  return runtime.authStrategy === 'credential-autofill' || runtime.authStrategy === 'hybrid';
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
  const [profiles, defaults, sessions, assignments, credentials] = await Promise.all([
    sb(
      env,
      `userflex_profiles?select=id,name,url,platform,image_url,tags,enabled,session_mode,session_ready,browser_engine,auth_strategy,storage_strategy,network_strategy,extension_strategy&id=in.(${ids})&enabled=eq.true`,
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
    sb(
      env,
      `userflex_profile_credentials?select=profile_id,updated_at&profile_id=in.(${ids})`,
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
  const credentialMap = new Map<string, any>((credentials || []).map((row: any) => [String(row.profile_id), row]));
  const credentialProfileIds = new Set(credentialMap.keys());
  const proxyMap = new Map((proxyRows || []).map((row: any) => [row.id, row]));
  const result = profileIds
    .map((profileId: string) => {
      const profile: any = profileMap.get(profileId);
      if (!profile) return null;
      const runtime = runtimeFor(profile);
      const snapshotRequired = needsSnapshot(runtime);
      const credentialsRequired = needsCredentials(runtime);
      const session: any = sessionMap.get(profile.id);
      const assignment: any = assignmentMap.get(profile.id);
      const assignmentProxyId = assignment?.proxy_id || null;
      const profileProxyId = defaultProxyMap.get(profile.id) || null;
      const profileProxy: any = profileProxyId ? proxyMap.get(profileProxyId) : null;
      const assignmentProxy: any = assignmentProxyId ? proxyMap.get(assignmentProxyId) : null;
      const hasCredentials = credentialProfileIds.has(String(profile.id));
      const snapshotReady = profile.session_ready === true && session?.status === 'ready';
      const sessionReady = (!snapshotRequired || snapshotReady) && (!credentialsRequired || hasCredentials);
      const networkUsesProxy = runtime.networkStrategy === 'profile-proxy'
        ? Boolean(profileProxyId)
        : runtime.networkStrategy === 'assigned-proxy'
          ? Boolean(assignmentProxyId)
          : runtime.networkStrategy === 'client-direct'
            ? false
            : runtime.authStrategy === 'manual'
              ? Boolean(assignmentProxyId || profileProxyId)
              : Boolean(profileProxyId);
      const activeProxy: any = runtime.networkStrategy === 'assigned-proxy'
        ? assignmentProxy
        : runtime.networkStrategy === 'client-direct'
          ? null
          : profileProxy || assignmentProxy;
      const currentPublicIp = inetHost(activeProxy?.public_ip) || session?.expected_egress_ip || null;
      return {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        platform: profile.platform,
        imageUrl: profile.image_url,
        tags: profile.tags || [],
        managedConnection: networkUsesProxy,
        sessionMode: profile.session_mode,
        sessionReady,
        sessionVersion: Number(session?.session_version || 0),
        credentialVersion: credentialMap.get(String(profile.id))?.updated_at || null,
        runtime,
        networkIdentity: {
          locked: runtime.networkStrategy === 'profile-proxy' || runtime.networkStrategy === 'assigned-proxy',
          publicIp: networkUsesProxy ? currentPublicIp : null,
          proxyType: activeProxy?.proxy_type || null,
          proxyStatus: activeProxy?.validation_status || null,
          strategy: runtime.networkStrategy,
        },
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
      `userflex_profiles?select=id,name,url,platform,image_url,tags,session_mode,session_ready,browser_engine,auth_strategy,storage_strategy,network_strategy,extension_strategy&id=eq.${profileId}&enabled=eq.true&limit=1`,
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

  const runtime = runtimeFor(profile);
  const snapshotRequired = needsSnapshot(runtime);
  const credentialsRequired = needsCredentials(runtime);
  const defaultProxyId = defaults?.[0]?.proxy_id || null;
  const assignmentProxyId = assignment?.proxy_id || null;

  let effectiveProxyId: string | null = null;
  let proxySource = 'direct';
  let proxyRequired = false;
  if (runtime.networkStrategy === 'client-direct') {
    effectiveProxyId = null;
  } else if (runtime.networkStrategy === 'profile-proxy') {
    effectiveProxyId = defaultProxyId;
    proxySource = 'profile-locked';
    proxyRequired = true;
  } else if (runtime.networkStrategy === 'assigned-proxy') {
    effectiveProxyId = assignmentProxyId;
    proxySource = 'assignment-locked';
    proxyRequired = true;
  } else if (runtime.authStrategy === 'manual') {
    effectiveProxyId = assignmentProxyId || defaultProxyId;
    proxySource = assignmentProxyId ? 'assignment' : defaultProxyId ? 'profile' : 'direct';
  } else {
    effectiveProxyId = defaultProxyId;
    proxySource = defaultProxyId ? 'profile-locked' : 'direct';
  }

  if (proxyRequired && !effectiveProxyId) {
    throw new HttpError(409, 'PROFILE_PROXY_REQUIRED', 'La estrategia de red del perfil exige un proxy que no está configurado.');
  }

  const autoManagedProxyLocked = runtime.networkStrategy === 'auto' && runtime.authStrategy !== 'manual' && Boolean(defaultProxyId);
  let connection: any = { mode: 'direct', locked: proxyRequired || autoManagedProxyLocked };
  let effectiveProxy: any = null;

  if (effectiveProxyId) {
    const rows = await sb(
      env,
      `userflex_proxies?select=id,host,port,username,password_ciphertext,password_iv,proxy_type,validation_status,public_ip&enabled=eq.true&id=eq.${effectiveProxyId}&limit=1`,
    );
    const proxy = rows?.[0];
    if (!proxy && (proxyRequired || effectiveProxyId)) {
      throw new HttpError(409, 'MANAGED_PROXY_UNAVAILABLE', 'El proxy requerido por el perfil no está disponible. Se bloqueó la salida directa para proteger la IP.');
    }
    if (proxy) {
      effectiveProxy = proxy;
      if (proxy.proxy_type === 'ssh') {
        throw new HttpError(409, 'PROXY_PROTOCOL_UNSUPPORTED', 'El proxy SSH necesita un túnel local y todavía no puede usarse directamente en userFLOW.');
      }
      connection = {
        mode: 'proxy',
        locked: proxyRequired || autoManagedProxyLocked,
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
    ready: !snapshotRequired,
    mode: profile.session_mode,
    materialIncluded: false,
    version: 0,
  };

  if (snapshotRequired) {
    const session = await managedSessionMaterial(env, profileId);
    if (!session || profile.session_ready !== true) {
      throw new HttpError(409, 'MANAGED_SESSION_NOT_READY', 'Este perfil necesita una sesión capturada antes de abrirse.');
    }
    const lockedNetwork = connection.mode === 'proxy' && connection.locked === true;
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

  let credentialDelivery: any = null;
  if (credentialsRequired) {
    const credentials = await managedProfileCredentials(env, profileId);
    if (!credentials?.username || !credentials?.password) {
      throw new HttpError(409, 'MANAGED_CREDENTIALS_NOT_READY', 'Este perfil necesita credenciales administradas antes de abrirse.');
    }
    credentialDelivery = {
      included: true,
      username: credentials.username,
      password: credentials.password,
      updatedAt: credentials.updatedAt,
    };
  }

  const usage = await openProfileUsage(request, env, id, { id: profile.id, name: profile.name, url: profile.url });

  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {
    deviceId: id.deviceId,
    usesProxy: connection.mode === 'proxy',
    proxySource,
    proxyType: connection.proxy?.type || null,
    managed: runtime.authStrategy !== 'manual',
    authStrategy: runtime.authStrategy,
    networkStrategy: runtime.networkStrategy,
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
      sessionReady: (!snapshotRequired || profile.session_ready === true),
      runtime,
    },
    connection,
    sessionDelivery,
    credentialDelivery,
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
