import type { AdminIdentity } from './auth';
import { touchProfileClients } from './client-revalidation';
import {
  credentialAuthentication,
  proxyRuntimeUsable,
  runtimeForProfile,
  selectNetworkPolicy,
  snapshotAuthentication,
} from './profile-runtime';
import { validateProxy } from './proxy-validation';
import {
  MIN_SESSION_MANAGER_VERSION,
  MIN_USERFLOW_VERSION,
  clientVersionFrom,
  sessionManagerVersionFrom,
  versionAtLeast,
} from './release-compat';
import {
  SessionMaterialValidationError,
  validateCapturedMaterialData,
} from './session-material';
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
const VALIDATION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSION_MATERIAL_BYTES = 8_000_000;
const MAX_VALIDATION_RESULT_BYTES = 100_000;

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

async function captureProxyForProfile(env: Env, profile: any) {
  const strategy = profile?.network_strategy || 'auto';
  if (strategy === 'client-direct' || strategy === 'assigned-proxy') return null;
  const proxy = await defaultProxy(env, profile.id);
  if (strategy === 'profile-proxy' && !proxy) {
    throw new HttpError(409, 'PROFILE_PROXY_REQUIRED', 'Este perfil exige un proxy fijo antes de capturar la sesión.');
  }
  return proxy;
}


async function liveValidateCaptureProxy(env: Env, proxy: any) {
  if (!proxy) return null;
  const password = proxy.password_ciphertext
    ? await decryptProxy(env, proxy.password_ciphertext, proxy.password_iv)
    : null;
  const validation = await validateProxy({
    host: proxy.host,
    port: Number(proxy.port),
    username: proxy.username || null,
    password,
  });

  await sb(env, `userflex_proxies?id=eq.${proxy.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      proxy_type: validation.proxyType,
      validation_status: validation.status,
      last_checked_at: validation.checkedAt,
      ...(validation.status === 'valid' ? { last_success_at: validation.checkedAt } : {}),
      last_latency_ms: validation.latencyMs,
      public_ip: validation.publicIp,
      country_code: validation.countryCode,
      country: validation.country,
      region: validation.region,
      city: validation.city,
      timezone: validation.timezone,
      validation_error: validation.error,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!validation.browserCompatible) {
    throw new HttpError(
      409,
      'PROFILE_PROXY_UNAVAILABLE',
      validation.error
        ? `El proxy ${proxy.name || 'del perfil'} no está disponible: ${validation.error}`
        : `El proxy ${proxy.name || 'del perfil'} no está disponible para abrir Chromium.`,
    );
  }

  return {
    ...proxy,
    proxy_type: validation.proxyType,
    validation_status: validation.status,
    public_ip: validation.publicIp,
  };
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

function assertUserflowVersion(request: Request) {
  const version = clientVersionFrom(request);
  if (!versionAtLeast(version, MIN_USERFLOW_VERSION)) {
    throw new HttpError(
      426,
      'CLIENT_UPDATE_REQUIRED',
      `Esta prueba requiere userFLOW v${MIN_USERFLOW_VERSION} o superior.`,
    );
  }
  return version;
}

function assertSessionManagerVersion(request: Request) {
  const version = sessionManagerVersionFrom(request);
  if (!versionAtLeast(version, MIN_SESSION_MANAGER_VERSION)) {
    throw new HttpError(
      426,
      'SESSION_MANAGER_UPDATE_REQUIRED',
      `Actualiza Session Manager a v${MIN_SESSION_MANAGER_VERSION} o superior.`,
    );
  }
  return version;
}

export function validateCapturedMaterial(profile: any, material: any) {
  try {
    return validateCapturedMaterialData(profile, material);
  } catch (error) {
    if (error instanceof SessionMaterialValidationError) {
      throw new HttpError(error.status, error.code, error.message);
    }
    throw error;
  }
}

async function proxyRecord(env: Env, proxyId: string | null) {
  if (!proxyId) return null;
  const rows = await sb(
    env,
    `userflex_proxies?select=id,name,host,port,username,password_ciphertext,password_iv,enabled,proxy_type,validation_status,public_ip&id=eq.${proxyId}&limit=1`,
  );
  return rows?.[0] || null;
}

async function profileValidationNetwork(env: Env, profile: any, clientId: string | null) {
  const runtime = runtimeForProfile(profile);
  const fixedProxy = await defaultProxy(env, profile.id);
  let assignmentProxy: any = null;
  let assignmentProxyId: string | null = null;

  if (clientId) {
    const rows = await sb(
      env,
      `userflex_assignments?select=proxy_id&client_id=eq.${clientId}&profile_id=eq.${profile.id}&enabled=eq.true&limit=1`,
    );
    assignmentProxyId = rows?.[0]?.proxy_id || null;
    assignmentProxy = await proxyRecord(env, assignmentProxyId);
  }

  const policy = selectNetworkPolicy(
    runtime,
    fixedProxy?.id || null,
    assignmentProxyId,
  );
  const selectedProxy = policy.effectiveProxyId === assignmentProxyId
    ? assignmentProxy
    : policy.effectiveProxyId === fixedProxy?.id
      ? fixedProxy
      : null;

  if (runtime.networkStrategy === 'assigned-proxy' && !clientId) {
    return { mode: 'missing-client', locked: true, source: policy.source, proxy: null };
  }

  return {
    mode: selectedProxy ? 'proxy' : 'direct',
    locked: policy.locked,
    required: policy.required,
    source: policy.source,
    proxy: selectedProxy,
    ready: policy.required
      ? Boolean(policy.effectiveProxyId && proxyRuntimeUsable(selectedProxy))
      : !policy.effectiveProxyId || proxyRuntimeUsable(selectedProxy),
  };
}

function materialCookies(material: any): any[] {
  return Array.isArray(material?.cookies) ? material.cookies : [];
}

async function configurationValidation(env: Env, profile: any, clientId: string | null) {
  const runtime = runtimeForProfile(profile);
  const checks: any[] = [];
  const add = (key: string, label: string, status: 'pass' | 'warn' | 'fail', detail: string) => {
    checks.push({ key, label, status, detail });
  };

  let googleProfile = runtime.extensionStrategy === 'google';
  try {
    const target = new URL(profile.url);
    const host = target.hostname.toLowerCase();
    googleProfile = googleProfile || host === 'google.com' || host.endsWith('.google.com');
    add('url', 'URL del perfil', ['http:', 'https:'].includes(target.protocol) ? 'pass' : 'fail', target.origin);
  } catch {
    add('url', 'URL del perfil', 'fail', 'La URL no es válida.');
  }

  add(
    'browser',
    'Motor de navegador',
    runtime.browserEngine === 'nstchrome' ? 'warn' : 'pass',
    runtime.browserEngine === 'nstchrome'
      ? (googleProfile
        ? 'Para perfiles Google se recomienda Chrome nativo. nstchrome solo debe usarse si el runtime autorizado está realmente instalado.'
        : 'nstchrome requiere que el runtime autorizado esté instalado en el equipo de prueba/cliente.')
      : 'Chrome nativo se validará en el equipo que ejecute userFLOW.',
  );

  const credentials = await credentialRow(env, profile.id);
  if (credentialAuthentication(runtime)) {
    add(
      'credentials',
      runtime.authStrategy === 'hybrid' ? 'Autofill + credenciales' : 'Credenciales',
      credentials ? 'pass' : 'fail',
      credentials
        ? (googleProfile ? 'Credenciales cifradas listas para autofill en Google/Google Accounts.' : 'Credenciales cifradas disponibles.')
        : 'Faltan credenciales administradas.',
    );
  } else if (runtime.authStrategy === 'cookie-snapshot') {
    add(
      'credentials',
      'Autofill opcional',
      credentials ? (googleProfile ? 'warn' : 'pass') : 'warn',
      credentials
        ? (googleProfile
          ? 'Hay credenciales guardadas, pero en modo snapshot el autofill es solo respaldo. Usa modo híbrido si quieres exigir snapshot + autofill.'
          : 'Hay credenciales disponibles como respaldo.')
        : 'No hay credenciales de respaldo; el snapshot puede funcionar igualmente.',
    );
  } else {
    add('credentials', 'Credenciales', 'pass', 'Este perfil no necesita credenciales administradas.');
  }

  let material: any = null;
  const session = await sessionRow(env, profile.id);
  if (snapshotAuthentication(runtime)) {
    if (!session || session.status !== 'ready' || !session.material_ciphertext || !session.material_iv) {
      add('snapshot', 'Snapshot de sesión', 'fail', 'No hay una sesión capturada lista.');
    } else {
      try {
        const raw = await decryptProxy(env, session.material_ciphertext, session.material_iv);
        material = JSON.parse(raw);
        add('snapshot', 'Snapshot de sesión', 'pass', `Sesión v${Number(session.session_version || 0)} disponible.`);
      } catch {
        add('snapshot', 'Snapshot de sesión', 'fail', 'El material cifrado de sesión no se pudo leer.');
      }
    }
  } else {
    add('snapshot', 'Snapshot de sesión', 'pass', 'La estrategia seleccionada no necesita snapshot.');
  }

  try {
    const [globalExtensions, profileMemberships] = await Promise.all([
      sb(env, 'userflex_extensions?select=id,name,enabled,validation_status,scope&scope=eq.global&order=name.asc'),
      sb(env, `userflex_profile_extensions?select=extension_id&profile_id=eq.${profile.id}`),
    ]);
    const selectiveIds = (profileMemberships || []).map((row: any) => row.extension_id);
    const selectiveExtensions = selectiveIds.length
      ? await sb(env, `userflex_extensions?select=id,name,enabled,validation_status,scope&id=in.(${selectiveIds.join(',')})&order=name.asc`)
      : [];
    const configuredExtensions = [...(globalExtensions || []), ...(selectiveExtensions || [])];
    const activeExtensions = configuredExtensions.filter((row: any) => row.enabled === true && row.validation_status === 'runtime_valid');
    const unavailableExtensions = configuredExtensions.filter((row: any) => row.enabled !== true || row.validation_status !== 'runtime_valid');

    add(
      'extensions',
      'Extensiones administradas',
      unavailableExtensions.length ? 'warn' : 'pass',
      configuredExtensions.length === 0
        ? 'Solo se cargará Browser Guard; no hay extensiones administradas configuradas.'
        : unavailableExtensions.length
          ? `${activeExtensions.length} listas para cargar. ${unavailableExtensions.length} configuradas no se cargarán porque están desactivadas o aún no están verificadas: ${unavailableExtensions.map((row: any) => row.name).join(', ')}.`
          : `Browser Guard + ${activeExtensions.length} extensión(es) verificadas se cargarán en userFLOW.`,
    );
  } catch {
    add('extensions', 'Extensiones administradas', 'warn', 'No se pudo comprobar el catálogo de extensiones en este momento.');
  }

  try {
    const target = new URL(profile.url);
    const host = target.hostname.toLowerCase();
    if (material && (host === 'netflix.com' || host.endsWith('.netflix.com'))) {
      const cookies = materialCookies(material);
      const names = new Set(cookies.map((cookie: any) => String(cookie?.name || '').toLowerCase()));
      const missing = ['netflixid', 'securenetflixid'].filter((name) => !names.has(name));
      const nowSeconds = Date.now() / 1000;
      const expiredAuth = cookies.some((cookie: any) => {
        const name = String(cookie?.name || '').toLowerCase();
        const expiry = Number(cookie?.expirationDate || cookie?.expires || 0);
        return ['netflixid', 'securenetflixid'].includes(name) && expiry > 0 && expiry <= nowSeconds;
      });
      add(
        'netflix-auth',
        'Cookies Netflix',
        missing.length || expiredAuth ? 'fail' : 'pass',
        missing.length
          ? `Faltan: ${missing.join(', ')}.`
          : expiredAuth ? 'Una cookie de autenticación de Netflix ya venció.' : 'NetflixId y SecureNetflixId están presentes.',
      );
    }
  } catch {}

  let network: any = await profileValidationNetwork(env, profile, clientId);
  let networkLiveError: string | null = null;
  if (network.proxy) {
    try {
      const checkedProxy = await liveValidateCaptureProxy(env, network.proxy);
      network = { ...network, proxy: checkedProxy, ready: true };
    } catch (error) {
      networkLiveError = error instanceof Error ? error.message : String(error || 'El proxy no respondió.');
      network = { ...network, ready: false };
    }
  }

  if (network.mode === 'missing-client') {
    add('network', 'Red', 'fail', 'Selecciona un cliente para probar su proxy asignado.');
  } else if (!network.ready) {
    add(
      'network',
      'Red',
      'fail',
      networkLiveError
        || (network.required && !network.proxy
          ? 'La estrategia exige un proxy pero no hay uno disponible.'
          : 'El proxy seleccionado está deshabilitado, usa un protocolo no compatible o falló validación.'),
    );
  } else if (network.proxy) {
    add(
      'network',
      'Red',
      'pass',
      `${network.source}: ${network.proxy.name || network.proxy.host} · ${network.proxy.validation_status || 'sin validar'}`,
    );
  } else {
    add('network', 'Red', 'pass', 'Salida directa; la IP real se verificará desde el equipo que ejecute userFLOW.');
  }

  return {
    profileId: profile.id,
    runtime,
    clientId,
    ready: !checks.some((check) => check.status === 'fail'),
    checks,
    network: {
      mode: network.mode,
      locked: network.locked,
      source: network.source,
      publicIp: network.proxy ? inetHost(network.proxy.public_ip) : null,
      proxyName: network.proxy?.name || null,
    },
  };
}

async function validationJob(env: Env, rawToken: string, allowRunning = true) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) throw new HttpError(401, 'INVALID_VALIDATION_TOKEN');
  const tokenHash = await sha(`userflex-profile-validation:${rawToken}`);
  const rows = await sb(
    env,
    `userflex_profile_validation_jobs?select=id,profile_id,client_id,status,expires_at,started_at,completed_at&token_hash=eq.${tokenHash}&limit=1`,
  );
  const job = rows?.[0];
  if (!job || !['pending', 'running'].includes(job.status)) throw new HttpError(401, 'VALIDATION_TOKEN_INVALID');
  if (!allowRunning && job.status !== 'pending') throw new HttpError(401, 'VALIDATION_TOKEN_ALREADY_USED');
  if (new Date(job.expires_at).getTime() <= Date.now()) {
    await sb(env, `userflex_profile_validation_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired', completed_at: new Date().toISOString() }),
    });
    throw new HttpError(401, 'VALIDATION_TOKEN_EXPIRED');
  }
  return job;
}

function safeDiagnosticUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function safeRuntimeDiagnostic(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = ['browserEngine', 'authStrategy', 'storageStrategy', 'networkStrategy', 'extensionStrategy'];
  const out: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof value[key] === 'string') out[key] = value[key].slice(0, 64);
  }
  return out;
}

function safeValidationResult(value: any) {
  const restore = value?.restore && typeof value.restore === 'object' ? {
    cookiesInstalled: Number(value.restore.cookiesInstalled || 0),
    cookiesRejected: Number(value.restore.cookiesRejected || 0),
    indexedDbRestored: Number(value.restore.indexedDbRestored || 0),
    indexedDbTotal: Number(value.restore.indexedDbTotal || 0),
    storagePolicy: value.restore.storagePolicy || null,
    pageUrl: safeDiagnosticUrl(value.restore.pageUrl),
  } : null;
  const autofill = value?.autofill && typeof value.autofill === 'object' ? {
    installed: value.autofill.installed === true,
    visibleHelper: value.autofill.visibleHelper === true,
    origin: value.autofill.origin || null,
  } : null;
  const inspection = value?.inspection && typeof value.inspection === 'object' ? {
    currentUrl: safeDiagnosticUrl(value.inspection.currentUrl),
    loginLikeUrl: value.inspection.loginLikeUrl === true,
    usernameFieldVisible: value.inspection.usernameFieldVisible === true,
    passwordFieldVisible: value.inspection.passwordFieldVisible === true,
    usernameFilled: value.inspection.usernameFilled === true,
    passwordFilled: value.inspection.passwordFilled === true,
    helperVisible: value.inspection.helperVisible === true,
  } : null;
  return {
    ok: value?.ok === true,
    outcome: typeof value?.outcome === 'string' ? value.outcome.slice(0, 120) : null,
    browser: typeof value?.browser === 'string' ? value.browser.slice(0, 160) : null,
    profileState: typeof value?.profileState === 'string' ? value.profileState.slice(0, 80) : null,
    network: typeof value?.network === 'string' ? value.network.slice(0, 80) : null,
    publicIp: typeof value?.publicIp === 'string' ? value.publicIp.slice(0, 64) : null,
    sessionVersion: Number(value?.sessionVersion || 0),
    runtime: safeRuntimeDiagnostic(value?.runtime),
    restore,
    autofill,
    inspection,
    testedAt: new Date().toISOString(),
  };
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

  if (credentialsMatch && method === 'DELETE') {
    const profileId = uuid(credentialsMatch[1], 'profileId');
    const profile = await profileRow(env, profileId);
    const runtime = runtimeForProfile(profile);
    if (credentialAuthentication(runtime)) {
      throw new HttpError(
        409,
        'CREDENTIALS_REQUIRED_BY_STRATEGY',
        'La estrategia actual exige credenciales. Cambia primero la autenticación a snapshot o manual.',
      );
    }
    await sb(env, `userflex_profile_credentials?profile_id=eq.${profileId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await sb(env, `userflex_profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.credentials.clear', 'profile', profileId);
    return json({ ok: true, profile_id: profileId, has_credentials: false });
  }

  const validationMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/validation$/i);
  if (validationMatch && method === 'POST') {
    const profileId = uuid(validationMatch[1], 'profileId');
    const profile = await profileRow(env, profileId);
    const body = await bodyJson(request);
    const clientId = body.clientId ? uuid(body.clientId, 'clientId') : null;
    const result = await configurationValidation(env, profile, clientId);
    await audit(env, request, 'admin', admin.userId, 'profile.validation.check', 'profile', profileId, {
      clientId,
      ready: result.ready,
      failedChecks: result.checks.filter((check: any) => check.status === 'fail').map((check: any) => check.key),
    });
    return json({ ok: true, validation: result });
  }

  const clientTestMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/client-test$/i);
  if (clientTestMatch && method === 'POST') {
    const profileId = uuid(clientTestMatch[1], 'profileId');
    const profile = await profileRow(env, profileId);
    const body = await bodyJson(request);
    const clientId = body.clientId ? uuid(body.clientId, 'clientId') : null;
    const validation = await configurationValidation(env, profile, clientId);
    if (!validation.ready) {
      throw new HttpError(409, 'PROFILE_VALIDATION_BLOCKED', 'Corrige los errores de configuración antes de probar como cliente.');
    }

    const rawToken = token(32);
    const tokenHash = await sha(`userflex-profile-validation:${rawToken}`);
    const expiresAt = new Date(Date.now() + VALIDATION_TTL_MS).toISOString();
    await sb(env, `userflex_profile_validation_jobs?profile_id=eq.${profileId}&status=in.(pending,running)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired', completed_at: new Date().toISOString() }),
    });
    const jobs = await sb(env, 'userflex_profile_validation_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        profile_id: profileId,
        client_id: clientId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      }),
    });
    const jobId = jobs?.[0]?.id;
    if (!jobId) throw new HttpError(500, 'VALIDATION_JOB_CREATE_FAILED');
    const launchUrl = `userflow-client://profile-test?endpoint=${encodeURIComponent(url.origin)}&token=${encodeURIComponent(rawToken)}`;
    await audit(env, request, 'admin', admin.userId, 'profile.validation.client_test.request', 'profile', profileId, {
      jobId,
      clientId,
      expiresAt,
      network: validation.network,
    });
    return json({
      ok: true,
      job_id: jobId,
      launch_url: launchUrl,
      expires_at: expiresAt,
      validation,
    });
  }

  const validationJobMatch = path.match(/^\/api\/profile-tests\/([0-9a-f-]{36})$/i);
  if (validationJobMatch && method === 'GET') {
    const jobId = uuid(validationJobMatch[1], 'jobId');
    const rows = await sb(
      env,
      `userflex_profile_validation_jobs?select=id,profile_id,client_id,status,result,error,expires_at,started_at,completed_at,created_at&id=eq.${jobId}&limit=1`,
    );
    let job = rows?.[0];
    if (!job) throw new HttpError(404, 'VALIDATION_JOB_NOT_FOUND');
    if (['pending', 'running'].includes(job.status) && new Date(job.expires_at).getTime() <= Date.now()) {
      const completedAt = new Date().toISOString();
      await sb(env, `userflex_profile_validation_jobs?id=eq.${jobId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'expired', completed_at: completedAt }),
      });
      job = { ...job, status: 'expired', completed_at: completedAt };
    }
    return json({ ok: true, job });
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
    const storedProxy = await captureProxyForProfile(env, profile);
    const proxy = storedProxy ? await liveValidateCaptureProxy(env, storedProxy) : null;
    if (proxy && !proxyRuntimeUsable(proxy)) {
      throw new HttpError(
        409,
        'PROFILE_PROXY_UNAVAILABLE',
        'El proxy del perfil está inactivo, usa un protocolo no compatible o falló validación.',
      );
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
    const saveUrl = `userflex-session://save?endpoint=${encodeURIComponent(endpoint)}&token=${encodeURIComponent(rawToken)}`;
    await audit(env, request, 'admin', admin.userId, 'profile.session.capture.request', 'profile', profileId, {
      jobId: jobs?.[0]?.id || null,
      expiresAt,
      proxyId: proxy?.id || null,
      proxyType: proxy?.proxy_type || null,
      networkMode: proxy ? 'proxy' : 'direct',
    });
    return json({ ok: true, launch_url: launchUrl, save_url: saveUrl, expires_at: expiresAt });
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

async function captureJob(env: Env, rawToken: string, phase: 'bootstrap' | 'complete') {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) throw new HttpError(401, 'INVALID_CAPTURE_TOKEN');
  const tokenHash = await sha(`userflex-session-capture:${rawToken}`);
  const rows = await sb(
    env,
    `userflex_profile_session_jobs?select=id,profile_id,status,expires_at,used_at&token_hash=eq.${tokenHash}&limit=1`,
  );
  const job = rows?.[0];
  if (!job || job.status !== 'pending') throw new HttpError(401, 'CAPTURE_TOKEN_INVALID');
  if (new Date(job.expires_at).getTime() <= Date.now()) {
    await sb(env, `userflex_profile_session_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired' }),
    });
    throw new HttpError(401, 'CAPTURE_TOKEN_EXPIRED');
  }

  if (phase === 'bootstrap') {
    if (job.used_at) throw new HttpError(401, 'CAPTURE_TOKEN_ALREADY_USED', 'Este enlace de captura ya fue aceptado por Session Manager. Si Chromium no se abrió, vuelve al panel y genera un enlace nuevo.');
    const claimedAt = new Date().toISOString();
    const claimed = await sb(env, `userflex_profile_session_jobs?id=eq.${job.id}&status=eq.pending&used_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ used_at: claimedAt }),
    });
    if (!claimed?.[0]) throw new HttpError(401, 'CAPTURE_TOKEN_ALREADY_USED', 'Este enlace de captura ya fue aceptado por Session Manager. Si Chromium no se abrió, vuelve al panel y genera un enlace nuevo.');
    return { ...job, used_at: claimedAt };
  }

  if (!job.used_at) throw new HttpError(409, 'CAPTURE_NOT_STARTED', 'Abre primero el enlace de captura en Session Manager.');
  return job;
}

export async function publicSessionManagerRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/client-test/bootstrap' && method === 'POST') {
    assertUserflowVersion(request);
    const body = await bodyJson(request);
    const rawToken = text(body.token, 'token', 128);
    const job = await validationJob(env, rawToken, false);
    const profile = await profileRow(env, job.profile_id);
    const runtime = runtimeForProfile(profile);
    const validation = await configurationValidation(env, profile, job.client_id || null);
    if (!validation.ready) {
      throw new HttpError(409, 'PROFILE_VALIDATION_BLOCKED', 'La configuración cambió y ya no está lista para probar.');
    }

    const now = new Date().toISOString();
    const claimed = await sb(env, `userflex_profile_validation_jobs?id=eq.${job.id}&status=eq.pending`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'running', started_at: now }),
    });
    if (!claimed?.[0]) throw new HttpError(401, 'VALIDATION_TOKEN_ALREADY_USED');

    const network = await profileValidationNetwork(env, profile, job.client_id || null);
    let connection: any = { mode: 'direct', locked: network.locked === true };
    if (network.proxy) {
      connection = {
        mode: 'proxy',
        locked: network.locked === true,
        proxy: {
          host: network.proxy.host,
          port: network.proxy.port,
          type: network.proxy.proxy_type || 'http',
          validationStatus: network.proxy.validation_status || null,
          publicIp: inetHost(network.proxy.public_ip),
          username: network.proxy.username || null,
          password: network.proxy.password_ciphertext
            ? await decryptProxy(env, network.proxy.password_ciphertext, network.proxy.password_iv)
            : null,
        },
      };
    }

    let sessionDelivery: any = {
      ready: !snapshotAuthentication(runtime),
      mode: profile.session_mode,
      materialIncluded: false,
      version: 0,
    };
    if (snapshotAuthentication(runtime)) {
      const session = await managedSessionMaterial(env, profile.id);
      if (!session) throw new HttpError(409, 'MANAGED_SESSION_NOT_READY');
      validateCapturedMaterial(profile, session.material);
      sessionDelivery = {
        ready: true,
        mode: profile.session_mode,
        materialIncluded: true,
        version: session.version,
        expectedPublicIp: connection.mode === 'proxy' && connection.locked
          ? (inetHost(network.proxy?.public_ip) || session.publicIp)
          : null,
        networkLocked: connection.mode === 'proxy' && connection.locked,
        capturedAt: session.capturedAt,
        validatedAt: session.validatedAt,
        material: session.material,
      };
    }

    const credential = await credentialRow(env, profile.id);
    const credentialRequired = credentialAuthentication(runtime);
    let credentialDelivery: any = null;
    if (credentialRequired && !credential) throw new HttpError(409, 'MANAGED_CREDENTIALS_NOT_READY');
    if (credential && (credentialRequired || runtime.authStrategy === 'cookie-snapshot')) {
      credentialDelivery = {
        included: true,
        required: credentialRequired,
        username: credential.login_username,
        password: await decryptProxy(env, credential.password_ciphertext, credential.password_iv),
        updatedAt: credential.updated_at || null,
      };
    }

    return json({
      ok: true,
      job: { id: job.id, expiresAt: job.expires_at },
      profile: {
        id: profile.id,
        name: profile.name,
        url: profile.url,
        sessionMode: profile.session_mode,
        sessionReady: profile.session_ready === true,
        runtime,
      },
      connection,
      sessionDelivery,
      credentialDelivery,
      validation,
    });
  }

  if (path === '/api/client-test/report' && method === 'POST') {
    assertUserflowVersion(request);
    const body = await bodyJson(request, 150_000);
    const rawToken = text(body.token, 'token', 128);
    const job = await validationJob(env, rawToken);
    const result = safeValidationResult(body.result);
    const serialized = JSON.stringify(result);
    if (new TextEncoder().encode(serialized).byteLength > MAX_VALIDATION_RESULT_BYTES) {
      throw new HttpError(413, 'VALIDATION_RESULT_TOO_LARGE');
    }
    const now = new Date().toISOString();
    await sb(env, `userflex_profile_validation_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: result.ok ? 'completed' : 'failed',
        result,
        error: result.ok ? null : optional(body.error, 1000),
        completed_at: now,
      }),
    });
    return json({ ok: true, job_id: job.id, status: result.ok ? 'completed' : 'failed' });
  }


  if (path === '/api/session-manager/bootstrap' && method === 'POST') {
    const sessionManagerVersion = assertSessionManagerVersion(request);
    const body = await bodyJson(request);
    const rawToken = text(body.token, 'token', 128);
    const job = await captureJob(env, rawToken, 'bootstrap');
    const profile = await profileRow(env, job.profile_id);
    const credentials = await credentialRow(env, job.profile_id);
    const proxy = await captureProxyForProfile(env, profile);
    const authStrategy = profile.auth_strategy || (profile.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
    if (authStrategy === 'hybrid' && !credentials) {
      throw new HttpError(409, 'CAPTURE_CONFIGURATION_INVALID', 'El perfil híbrido ya no tiene credenciales guardadas.');
    }
    if (proxy && !proxyRuntimeUsable(proxy)) {
      throw new HttpError(
        409,
        'PROFILE_PROXY_UNAVAILABLE',
        'El proxy del perfil está inactivo, usa un protocolo no compatible o falló validación.',
      );
    }
    return json({
      ok: true,
      minimumSessionManagerVersion: MIN_SESSION_MANAGER_VERSION,
      sessionManagerVersion,
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
    assertSessionManagerVersion(request);
    const body = await bodyJson(request, 10_000_000);
    const rawToken = text(body.token, 'token', 128);
    const job = await captureJob(env, rawToken, 'complete');
    const profile = await profileRow(env, job.profile_id);
    const material = body.material;
    validateCapturedMaterial(profile, material);
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
      body: JSON.stringify({ status: 'completed' }),
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
