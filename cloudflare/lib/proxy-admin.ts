import type { AdminIdentity } from './auth';
import {
  Env,
  HttpError,
  audit,
  bodyJson,
  decryptProxy,
  encryptProxy,
  integer,
  json,
  optional,
  sb,
  text,
  uuid,
} from './core';
import {
  proxyBrowserCompatible,
  validateProxy,
  type ProxyProtocol,
  type ProxyValidationResult,
  type ProxyValidationStatus,
} from './proxy-validation';

const PROXY_SELECT = [
  'id',
  'name',
  'host',
  'port',
  'username',
  'password_ciphertext',
  'password_iv',
  'key_version',
  'enabled',
  'proxy_type',
  'validation_status',
  'last_checked_at',
  'last_success_at',
  'last_latency_ms',
  'public_ip',
  'country_code',
  'country',
  'region',
  'city',
  'timezone',
  'validation_error',
  'created_at',
  'updated_at',
].join(',');

function proxyHost(value: unknown): string {
  const host = text(value, 'host', 255);
  if (/[\s/@]/.test(host)) throw new HttpError(400, 'INVALID_PROXY_HOST', 'El host del proxy no es válido.');
  return host;
}

function safeProxy(proxy: any) {
  const proxyType = (proxy.proxy_type || 'unknown') as ProxyProtocol;
  const validationStatus = (proxy.validation_status || 'pending') as ProxyValidationStatus;
  return {
    id: proxy.id,
    name: proxy.name,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username || null,
    enabled: proxy.enabled === true,
    has_password: Boolean(proxy.password_ciphertext),
    proxy_type: proxyType,
    validation_status: validationStatus,
    last_checked_at: proxy.last_checked_at || null,
    last_success_at: proxy.last_success_at || null,
    last_latency_ms: Number.isFinite(Number(proxy.last_latency_ms)) ? Number(proxy.last_latency_ms) : null,
    public_ip: proxy.public_ip || null,
    country_code: proxy.country_code || null,
    country: proxy.country || null,
    region: proxy.region || null,
    city: proxy.city || null,
    timezone: proxy.timezone || null,
    validation_error: proxy.validation_error || null,
    browser_compatible: proxyBrowserCompatible(proxyType, validationStatus),
    created_at: proxy.created_at,
    updated_at: proxy.updated_at,
  };
}

function validationFields(result: ProxyValidationResult, includeNullLastSuccess = false) {
  const fields: Record<string, unknown> = {
    proxy_type: result.proxyType,
    validation_status: result.status,
    last_checked_at: result.checkedAt,
    last_latency_ms: result.latencyMs,
    public_ip: result.publicIp,
    country_code: result.countryCode,
    country: result.country,
    region: result.region,
    city: result.city,
    timezone: result.timezone,
    validation_error: result.error,
  };
  if (result.status === 'valid') fields.last_success_at = result.checkedAt;
  else if (includeNullLastSuccess) fields.last_success_at = null;
  return fields;
}

async function storedProxy(env: Env, id: string) {
  const rows = await sb(env, `userflex_proxies?select=${PROXY_SELECT}&id=eq.${id}&limit=1`);
  const proxy = rows?.[0];
  if (!proxy) throw new HttpError(404, 'PROXY_NOT_FOUND', 'El proxy no existe.');
  return proxy;
}

async function storedPassword(env: Env, proxy: any) {
  if (!proxy?.password_ciphertext) return null;
  if (!proxy?.password_iv) throw new HttpError(500, 'PROXY_SECRET_INVALID', 'La clave cifrada del proxy está incompleta.');
  return decryptProxy(env, proxy.password_ciphertext, proxy.password_iv);
}

function validationFailure(result: ProxyValidationResult) {
  return result.error || 'No se pudo comprobar la conexión del proxy.';
}

export async function adminProxyRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/proxies' && method === 'GET') {
    const rows = await sb(env, `userflex_proxies?select=${PROXY_SELECT}&order=name.asc`);
    return json((rows || []).map(safeProxy));
  }

  if (path === '/api/proxies' && method === 'POST') {
    const body = await bodyJson(request);
    const name = text(body.name, 'name', 100);
    const host = proxyHost(body.host);
    const port = integer(body.port, 1, 65535, 'port');
    const username = optional(body.username, 160);
    const password = body.password ? text(body.password, 'password', 512) : null;
    const validation = await validateProxy({ host, port, username, password });

    if (validation.status === 'invalid') {
      throw new HttpError(422, 'PROXY_VALIDATION_FAILED', validationFailure(validation));
    }

    const row: Record<string, unknown> = {
      name,
      host,
      port,
      username,
      enabled: body.enabled !== false,
      ...validationFields(validation, true),
    };
    if (password) {
      const secret = await encryptProxy(env, password);
      Object.assign(row, {
        password_ciphertext: secret.ciphertext,
        password_iv: secret.iv,
        key_version: secret.keyVersion,
      });
    }

    const rows = await sb(env, 'userflex_proxies', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    const created = rows?.[0];
    if (!created) throw new HttpError(502, 'PROXY_CREATE_FAILED', 'No se pudo crear el proxy.');
    await audit(env, request, 'admin', admin.userId, 'proxy.create', 'proxy', created.id, {
      host,
      port,
      proxyType: validation.proxyType,
      validationStatus: validation.status,
      publicIp: validation.publicIp,
      hasPassword: Boolean(created.password_ciphertext),
    });
    return json(safeProxy(created), 201);
  }

  const validateMatch = path.match(/^\/api\/proxies\/([0-9a-f-]{36})\/validate$/i);
  if (validateMatch && method === 'POST') {
    const proxyId = uuid(validateMatch[1], 'proxyId');
    const current = await storedProxy(env, proxyId);
    const password = await storedPassword(env, current);
    const validation = await validateProxy({
      host: current.host,
      port: Number(current.port),
      username: current.username || null,
      password,
    });
    const rows = await sb(env, `userflex_proxies?id=eq.${proxyId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(validationFields(validation)),
    });
    const updated = rows?.[0];
    if (!updated) throw new HttpError(404, 'PROXY_NOT_FOUND', 'El proxy no existe.');
    await audit(env, request, 'admin', admin.userId, 'proxy.validate', 'proxy', proxyId, {
      proxyType: validation.proxyType,
      validationStatus: validation.status,
      publicIp: validation.publicIp,
      latencyMs: validation.latencyMs,
    });
    return json(safeProxy(updated));
  }

  const proxyMatch = path.match(/^\/api\/proxies\/([0-9a-f-]{36})$/i);
  if (proxyMatch && method === 'PATCH') {
    const proxyId = uuid(proxyMatch[1], 'proxyId');
    const current = await storedProxy(env, proxyId);
    const body = await bodyJson(request);
    const patch: Record<string, unknown> = {};

    const nextName = body.name !== undefined ? text(body.name, 'name', 100) : current.name;
    const nextHost = body.host !== undefined ? proxyHost(body.host) : current.host;
    const nextPort = body.port !== undefined ? integer(body.port, 1, 65535, 'port') : Number(current.port);
    const nextUsername = body.username !== undefined ? optional(body.username, 160) : current.username || null;
    let nextPassword = await storedPassword(env, current);
    let passwordChanged = false;

    if (body.clearPassword === true) {
      nextPassword = null;
      passwordChanged = true;
      patch.password_ciphertext = null;
      patch.password_iv = null;
      patch.key_version = null;
    } else if (typeof body.password === 'string' && body.password.length > 0) {
      nextPassword = text(body.password, 'password', 512);
      passwordChanged = true;
      const secret = await encryptProxy(env, nextPassword);
      patch.password_ciphertext = secret.ciphertext;
      patch.password_iv = secret.iv;
      patch.key_version = secret.keyVersion;
    }

    if (body.name !== undefined) patch.name = nextName;
    if (body.host !== undefined) patch.host = nextHost;
    if (body.port !== undefined) patch.port = nextPort;
    if (body.username !== undefined) patch.username = nextUsername;
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

    const connectionChanged = nextHost !== current.host
      || nextPort !== Number(current.port)
      || nextUsername !== (current.username || null)
      || passwordChanged;

    let validation: ProxyValidationResult | null = null;
    if (connectionChanged) {
      validation = await validateProxy({ host: nextHost, port: nextPort, username: nextUsername, password: nextPassword });
      if (validation.status === 'invalid') {
        throw new HttpError(422, 'PROXY_VALIDATION_FAILED', validationFailure(validation));
      }
      Object.assign(patch, validationFields(validation));
    }

    if (Object.keys(patch).length === 0) return json(safeProxy(current));

    const rows = await sb(env, `userflex_proxies?id=eq.${proxyId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    const updated = rows?.[0];
    if (!updated) throw new HttpError(404, 'PROXY_NOT_FOUND', 'El proxy no existe.');
    await audit(env, request, 'admin', admin.userId, 'proxy.update', 'proxy', proxyId, {
      host: updated.host,
      port: updated.port,
      proxyType: updated.proxy_type,
      validationStatus: updated.validation_status,
      revalidated: Boolean(validation),
      hasPassword: Boolean(updated.password_ciphertext),
    });
    return json(safeProxy(updated));
  }

  return null;
}
