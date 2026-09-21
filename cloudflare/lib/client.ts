import { ClientIdentity } from './auth';
import { CLIENT_SESSION_SECONDS, Env, HttpError, audit, bodyJson, decryptProxy, json, sb } from './core';
import { managedProfileCredentials, managedSessionMaterial, validateCapturedMaterial } from './profile-sessions';
import { closeOpenProfileUsageForSession, openProfileUsage } from './profile-usage';
import { managedExtensionsForProfiles } from './extensions';
import {
  credentialAuthentication,
  proxyRuntimeUsable,
  runtimeForProfile,
  selectNetworkPolicy,
  snapshotAuthentication,
} from './profile-runtime';
import {
  MIN_USERFLOW_VERSION,
  clientVersionFrom,
  versionAtLeast,
} from './release-compat';
import { clientRealtimeConfig } from './client-revalidation';

function inetHost(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  return raw.split('/')[0] || null;
}

export async function clientCatalog(env: Env, id: ClientIdentity) {
  const realtime = await clientRealtimeConfig(env, id.clientId);
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
      offlineGraceMinutes: Number(id.subscription.offline_grace_minutes || 0),
      realtime,
      minimumClientVersion: MIN_USERFLOW_VERSION,
    });
  }

  const profileIds = memberships.map((membership: any) => membership.profile_id);
  const ids = profileIds.join(',');
  const [profiles, defaults, sessions, assignments, credentials, extensionMap] = await Promise.all([
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
    managedExtensionsForProfiles(env, profileIds),
  ]);

  const proxyIds = [...new Set([
    ...(defaults || []).map((row: any) => String(row.proxy_id || '')).filter(Boolean),
    ...(assignments || []).map((row: any) => String(row.proxy_id || '')).filter(Boolean),
  ])];
  const proxyRows = proxyIds.length
    ? await sb(
        env,
        `userflex_proxies?select=id,proxy_type,validation_status,public_ip,enabled&id=in.(${proxyIds.join(',')})`,
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
      const runtime = runtimeForProfile(profile);
      const snapshotRequired = snapshotAuthentication(runtime);
      const credentialsRequired = credentialAuthentication(runtime);
      const session: any = sessionMap.get(profile.id);
      const assignment: any = assignmentMap.get(profile.id);
      const assignmentProxyId = assignment?.proxy_id ? String(assignment.proxy_id) : null;
      const profileProxyId = defaultProxyMap.get(profile.id) ? String(defaultProxyMap.get(profile.id)) : null;
      const profileProxy: any = profileProxyId ? proxyMap.get(profileProxyId) : null;
      const assignmentProxy: any = assignmentProxyId ? proxyMap.get(assignmentProxyId) : null;
      const hasCredentials = credentialProfileIds.has(String(profile.id));
      const snapshotReady = profile.session_ready === true && session?.status === 'ready';
      const sessionReady = (!snapshotRequired || snapshotReady) && (!credentialsRequired || hasCredentials);
      const networkPolicy = selectNetworkPolicy(runtime, profileProxyId, assignmentProxyId);
      const activeProxy: any = networkPolicy.effectiveProxyId
        ? proxyMap.get(networkPolicy.effectiveProxyId)
        : null;
      const networkReady = networkPolicy.required
        ? Boolean(networkPolicy.effectiveProxyId && proxyRuntimeUsable(activeProxy))
        : !networkPolicy.effectiveProxyId || proxyRuntimeUsable(activeProxy);
      const networkUsesProxy = Boolean(networkPolicy.effectiveProxyId);
      const currentPublicIp = networkUsesProxy
        ? (inetHost(activeProxy?.public_ip) || session?.expected_egress_ip || null)
        : null;
      const launchReady = sessionReady && networkReady;
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
        networkReady,
        launchReady,
        unavailableReason: !sessionReady
          ? 'Autenticación/sesión no lista'
          : !networkReady
            ? networkPolicy.required && !networkPolicy.effectiveProxyId
              ? 'Falta el proxy requerido por el perfil'
              : 'El proxy configurado no está disponible o no es compatible'
            : null,
        sessionVersion: Number(session?.session_version || 0),
        credentialVersion: credentialMap.get(String(profile.id))?.updated_at || null,
        runtime,
        extensions: extensionMap.get(profile.id) || [],
        networkIdentity: {
          locked: networkPolicy.locked,
          publicIp: currentPublicIp,
          proxyType: activeProxy?.proxy_type || null,
          proxyStatus: activeProxy?.validation_status || null,
          strategy: runtime.networkStrategy,
          source: networkPolicy.source,
          ready: networkReady,
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
    offlineGraceMinutes: Number(id.subscription.offline_grace_minutes || 0),
    realtime,
    minimumClientVersion: MIN_USERFLOW_VERSION,
  });
}

export async function clientLaunch(
  request: Request,
  env: Env,
  id: ClientIdentity,
  profileId: string,
) {
  const clientVersion = clientVersionFrom(request);
  if (!versionAtLeast(clientVersion, MIN_USERFLOW_VERSION)) {
    throw new HttpError(
      426,
      'CLIENT_UPDATE_REQUIRED',
      `Actualiza userFLOW a v${MIN_USERFLOW_VERSION} o superior antes de abrir perfiles.`,
    );
  }

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
  const extensionMap = await managedExtensionsForProfiles(env, [profileId]);
  const managedExtensions = extensionMap.get(profileId) || [];

  const runtime = runtimeForProfile(profile);
  const snapshotRequired = snapshotAuthentication(runtime);
  const credentialsRequired = credentialAuthentication(runtime);
  const defaultProxyId = defaults?.[0]?.proxy_id || null;
  const assignmentProxyId = assignment?.proxy_id || null;

  const networkPolicy = selectNetworkPolicy(runtime, defaultProxyId, assignmentProxyId);
  const effectiveProxyId = networkPolicy.effectiveProxyId;
  const proxySource = networkPolicy.source;

  if (networkPolicy.required && !effectiveProxyId) {
    throw new HttpError(409, 'PROFILE_PROXY_REQUIRED', 'La estrategia de red del perfil exige un proxy que no está configurado.');
  }

  let connection: any = { mode: 'direct', locked: networkPolicy.locked };
  let effectiveProxy: any = null;

  if (effectiveProxyId) {
    const rows = await sb(
      env,
      `userflex_proxies?select=id,host,port,username,password_ciphertext,password_iv,proxy_type,validation_status,public_ip,enabled&id=eq.${effectiveProxyId}&limit=1`,
    );
    const proxy = rows?.[0];
    if (!proxy || !proxyRuntimeUsable(proxy)) {
      throw new HttpError(
        409,
        'MANAGED_PROXY_UNAVAILABLE',
        'El proxy seleccionado está deshabilitado, no es compatible o falló validación. Se bloqueó la salida directa para proteger la IP.',
      );
    }
    if (proxy) {
      effectiveProxy = proxy;
      connection = {
        mode: 'proxy',
        locked: networkPolicy.locked,
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
    validateCapturedMaterial(profile, session.material);
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
  const credentialHelperAllowed = credentialsRequired || runtime.authStrategy === 'cookie-snapshot';
  if (credentialHelperAllowed) {
    const credentials = await managedProfileCredentials(env, profileId);
    if (credentialsRequired && (!credentials?.username || !credentials?.password)) {
      throw new HttpError(409, 'MANAGED_CREDENTIALS_NOT_READY', 'Este perfil necesita credenciales administradas antes de abrirse.');
    }
    if (credentials?.username && credentials?.password) {
      credentialDelivery = {
        included: true,
        required: credentialsRequired,
        username: credentials.username,
        password: credentials.password,
        updatedAt: credentials.updatedAt,
      };
    }
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
    extensionCount: managedExtensions.length,
  });

  return json({
    ok: true,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
    configRevision: id.client.updated_at,
    lease: {
      expiresAt: id.subscription.expires_at,
      offlineGraceMinutes: Number(id.subscription.offline_grace_minutes || 0),
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
      extensions: managedExtensions,
    },
    connection,
    sessionDelivery,
    credentialDelivery,
    usage,
    minimumClientVersion: MIN_USERFLOW_VERSION,
    clientVersion,
  });
}

export async function clientHeartbeat(request: Request, env: Env, id: ClientIdentity) {
  const clientVersion = clientVersionFrom(request);
  if (!versionAtLeast(clientVersion, MIN_USERFLOW_VERSION)) {
    return json({
      ok: false,
      active: false,
      revoke: true,
      updateRequired: true,
      code: 'CLIENT_UPDATE_REQUIRED',
      minimumClientVersion: MIN_USERFLOW_VERSION,
      clientVersion: clientVersion || null,
      message: `Actualiza userFLOW a v${MIN_USERFLOW_VERSION} o superior.`,
      serverTime: new Date().toISOString(),
    });
  }

  const sessionExpiresAt = new Date(Date.now() + CLIENT_SESSION_SECONDS * 1000).toISOString();
  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ expires_at: sessionExpiresAt, last_seen_at: new Date().toISOString() }),
  });
  const realtime = await clientRealtimeConfig(env, id.clientId);
  return json({
    ok: true,
    active: true,
    revoke: false,
    client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },
    configRevision: id.client.updated_at,
    plan: { id: id.plan.id, name: id.plan.name },
    expiresAt: id.subscription.expires_at,
    sessionExpiresAt,
    realtime,
    serverTime: new Date().toISOString(),
    minimumClientVersion: MIN_USERFLOW_VERSION,
  });
}

export async function clientSessionHealth(
  request: Request,
  env: Env,
  id: ClientIdentity,
  profileId: string,
) {
  const clientVersion = clientVersionFrom(request);
  if (!versionAtLeast(clientVersion, MIN_USERFLOW_VERSION)) {
    throw new HttpError(426, 'CLIENT_UPDATE_REQUIRED', `Actualiza userFLOW a v${MIN_USERFLOW_VERSION} o superior.`);
  }
  const memberships = await sb(
    env,
    `userflex_plan_profiles?select=profile_id&plan_id=eq.${id.plan.id}&profile_id=eq.${profileId}&limit=1`,
  );
  if (!memberships?.[0]) {
    throw new HttpError(403, 'PROFILE_NOT_INCLUDED_IN_PLAN', 'Este perfil no está incluido en tu plan activo.');
  }
  const body = await bodyJson(request);
  const authenticated = body.authenticated === true;
  const reportedVersion = Math.max(0, Number(body.sessionVersion || 0));
  const source = typeof body.source === 'string' ? body.source.slice(0, 64) : '';
  const currentRows = await sb(
    env,
    `userflex_profile_sessions?select=session_version,status&profile_id=eq.${profileId}&limit=1`,
  );
  const current = currentRows?.[0] || null;
  const currentVersion = Number(current?.session_version || 0);
  const now = new Date().toISOString();
  const sameCentralGeneration = current?.status === 'ready'
    && reportedVersion > 0
    && reportedVersion === currentVersion;
  const centralUpdated = authenticated
    ? sameCentralGeneration
    : sameCentralGeneration && source === 'server-session-restored';

  if (centralUpdated) {
    await sb(env, `userflex_profile_sessions?profile_id=eq.${profileId}&status=eq.ready`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_validated_at: authenticated ? now : null,
        updated_at: now,
      }),
    });
  }
  return json({
    ok: true,
    authenticated,
    checkedAt: now,
    reportedVersion,
    currentVersion,
    centralUpdated,
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
