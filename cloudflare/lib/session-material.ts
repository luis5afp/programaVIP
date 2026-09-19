export class SessionMaterialValidationError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SessionMaterialValidationError';
    this.status = status;
    this.code = code;
  }
}

function fail(status: number, code: string, message: string): never {
  throw new SessionMaterialValidationError(status, code, message);
}

function cookieMatchesHost(cookie: any, hostname: string) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  const host = String(hostname || '').toLowerCase();
  return Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
}

export function validateCapturedMaterialData(profile: any, material: any) {
  if (!material || typeof material !== 'object' || Array.isArray(material)) {
    fail(400, 'INVALID_SESSION_MATERIAL', 'El material de sesión no es válido.');
  }
  if (!['userflex-browser-session-v1', 'userflex-browser-session-v2'].includes(String(material.format || ''))) {
    fail(400, 'SESSION_MATERIAL_FORMAT_INVALID', 'El formato de la sesión capturada no es compatible.');
  }

  let target: URL;
  try {
    target = new URL(String(profile?.url || ''));
  } catch {
    fail(400, 'PROFILE_URL_INVALID', 'La URL del perfil no es válida.');
  }

  if (String(material.profileId || '') !== String(profile?.id || '')) {
    fail(409, 'SESSION_PROFILE_MISMATCH', 'La sesión capturada no pertenece a este perfil.');
  }
  if (String(material.allowedOrigin || '') !== target.origin) {
    fail(409, 'SESSION_ORIGIN_MISMATCH', 'El origen de la sesión capturada no coincide con la web del perfil.');
  }

  if (material.capturedUrl) {
    try {
      if (new URL(String(material.capturedUrl)).origin !== target.origin) {
        fail(409, 'SESSION_CAPTURE_URL_MISMATCH', 'La sesión fue capturada desde otra web.');
      }
    } catch (error) {
      if (error instanceof SessionMaterialValidationError) throw error;
      fail(400, 'SESSION_CAPTURE_URL_INVALID', 'La URL capturada no es válida.');
    }
  }

  if (material?.storage?.origin && String(material.storage.origin) !== target.origin) {
    fail(409, 'SESSION_STORAGE_ORIGIN_MISMATCH', 'El storage capturado pertenece a otro origen.');
  }

  const cookies = Array.isArray(material.cookies) ? material.cookies : [];
  if (cookies.length > 5000) {
    fail(413, 'SESSION_COOKIE_COUNT_TOO_LARGE', 'La captura contiene demasiadas cookies.');
  }

  const hostname = target.hostname.toLowerCase();
  const unrelatedCookies = cookies.filter((cookie) => !cookieMatchesHost(cookie, hostname));
  if (unrelatedCookies.length) {
    fail(409, 'SESSION_COOKIE_DOMAIN_MISMATCH', 'La sesión contiene cookies que no pertenecen a la web del perfil.');
  }
  if (hostname === 'netflix.com' || hostname.endsWith('.netflix.com')) {
    const nowSeconds = Date.now() / 1000;
    const authCookies = new Map<string, any>();
    for (const cookie of cookies) {
      const name = String(cookie?.name || '').toLowerCase();
      if (!['netflixid', 'securenetflixid'].includes(name)) continue;
      if (!cookieMatchesHost(cookie, hostname)) continue;
      authCookies.set(name, cookie);
    }

    const missing = ['netflixid', 'securenetflixid'].filter((name) => {
      const cookie = authCookies.get(name);
      if (!cookie || !String(cookie.value ?? '')) return true;
      const expiry = Number(cookie.expirationDate ?? cookie.expires ?? 0);
      return Number.isFinite(expiry) && expiry > 0 && expiry <= nowSeconds;
    });

    if (missing.length) {
      fail(
        409,
        'NETFLIX_AUTH_COOKIES_INVALID',
        `La captura de Netflix no contiene cookies de autenticación activas: ${missing.join(', ')}.`,
      );
    }
  }

  return { target, cookies };
}


type ImportedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'None' | 'Lax' | 'Strict';
  expirationDate?: number;
  hostOnly?: boolean;
};

function normalizeCookieDomain(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.length > 253) return null;
  const withoutScheme = raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const host = withoutScheme.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host || host.includes('..') || !/^[a-z0-9.-]+$/i.test(host)) return null;
  return { host, leadingDot: raw.startsWith('.') };
}

function cookieDomainFromUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeImportedSameSite(value: unknown): ImportedCookie['sameSite'] | undefined {
  switch (String(value || '').trim().toLowerCase().replace(/[_\s-]+/g, '')) {
    case 'none':
    case 'norestriction':
      return 'None';
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    default:
      return undefined;
  }
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const valueText = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(valueText)) return true;
  if (['false', '0', 'no'].includes(valueText)) return false;
  return fallback;
}

function expirySeconds(value: unknown) {
  if (value === null || value === undefined || value === '' || value === -1 || value === '-1') return null;
  let numberValue: number;
  if (typeof value === 'number') numberValue = value;
  else {
    const raw = String(value).trim();
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) numberValue = Number(raw);
    else {
      const date = Date.parse(raw);
      if (!Number.isFinite(date)) return null;
      numberValue = date / 1000;
    }
  }
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  if (numberValue > 10_000_000_000) numberValue /= 1000;
  return Math.floor(numberValue);
}

function cookieArrayFromJson(value: any): { cookies: any[]; format: string } {
  if (Array.isArray(value)) return { cookies: value, format: 'cookie-array' };
  if (!value || typeof value !== 'object') {
    fail(400, 'COOKIE_IMPORT_FORMAT_INVALID', 'El JSON debe contener un arreglo de cookies o un objeto con una propiedad cookies.');
  }

  const candidates: Array<[unknown, string]> = [
    [value.cookies, 'object.cookies'],
    [value.Cookies, 'object.Cookies'],
    [value.storageState?.cookies, 'playwright-storage-state'],
    [value.material?.cookies, 'userflex-material'],
    [value.data?.cookies, 'object.data.cookies'],
    [value.export?.cookies, 'object.export.cookies'],
  ];
  for (const [candidate, format] of candidates) {
    if (Array.isArray(candidate)) return { cookies: candidate, format };
  }
  fail(400, 'COOKIE_IMPORT_FORMAT_INVALID', 'No se encontró un arreglo de cookies compatible dentro del JSON.');
}

function importedCookie(raw: any): { cookie: ImportedCookie | null; expired: boolean; reason?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { cookie: null, expired: false, reason: 'invalid-object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const value = raw.value === undefined || raw.value === null ? null : String(raw.value);
  if (!name || value === null || name.length > 1024 || /[\u0000-\u001f\u007f;]/.test(name) || value.length > 16384) {
    return { cookie: null, expired: false, reason: 'invalid-name-value' };
  }

  const rawDomain = raw.domain ?? raw.host ?? raw.hostname ?? cookieDomainFromUrl(raw.url);
  const parsedDomain = normalizeCookieDomain(rawDomain);
  if (!parsedDomain) return { cookie: null, expired: false, reason: 'invalid-domain' };

  const path = typeof raw.path === 'string' && raw.path.startsWith('/') && raw.path.length <= 2048 ? raw.path : '/';
  const sameSite = normalizeImportedSameSite(raw.sameSite ?? raw.same_site);
  const expires = expirySeconds(raw.expirationDate ?? raw.expires ?? raw.expiry ?? raw.expiration ?? raw.expiryDate);
  const session = booleanValue(raw.session, false);
  if (!session && expires && expires <= Math.floor(Date.now() / 1000)) {
    return { cookie: null, expired: true, reason: 'expired' };
  }

  const hostOnly = typeof raw.hostOnly === 'boolean'
    ? raw.hostOnly
    : typeof raw.host_only === 'boolean'
      ? raw.host_only
      : false;

  const cookie: ImportedCookie = {
    name,
    value,
    domain: hostOnly ? parsedDomain.host : `.${parsedDomain.host}`,
    path,
    secure: booleanValue(raw.secure, true) || sameSite === 'None',
    httpOnly: booleanValue(raw.httpOnly ?? raw.http_only, false),
    ...(sameSite ? { sameSite } : {}),
    ...(expires && !session ? { expirationDate: expires } : {}),
    hostOnly,
  };
  return { cookie, expired: false };
}

function targetInfo(targetUrl: string) {
  let target: URL;
  try {
    target = new URL(String(targetUrl || ''));
  } catch {
    fail(400, 'PROFILE_URL_INVALID', 'La URL del perfil no es válida.');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    fail(400, 'PROFILE_URL_INVALID', 'La URL del perfil debe usar HTTP o HTTPS.');
  }
  return target;
}

function cookieAppliesToHost(cookie: ImportedCookie, hostname: string) {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  const host = hostname.toLowerCase();
  if (cookie.hostOnly === true) return host === domain;
  return host === domain || host.endsWith(`.${domain}`);
}

export function inspectCookieImport(targetUrl: string, jsonValue: any) {
  const target = targetInfo(targetUrl);
  const extracted = cookieArrayFromJson(jsonValue);
  if (extracted.cookies.length > 5000) {
    fail(413, 'SESSION_COOKIE_COUNT_TOO_LARGE', 'El archivo contiene más de 5000 cookies.');
  }

  const domainCounts = new Map<string, number>();
  const matching: ImportedCookie[] = [];
  let validCookies = 0;
  let expiredCookies = 0;
  let invalidCookies = 0;

  for (const raw of extracted.cookies) {
    const normalized = importedCookie(raw);
    if (normalized.expired) {
      expiredCookies += 1;
      continue;
    }
    if (!normalized.cookie) {
      invalidCookies += 1;
      continue;
    }
    validCookies += 1;
    const domain = normalized.cookie.domain.replace(/^\./, '').toLowerCase();
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    if (cookieAppliesToHost(normalized.cookie, target.hostname)) matching.push(normalized.cookie);
  }

  const deduped = new Map<string, ImportedCookie>();
  for (const cookie of matching) {
    deduped.set(`${cookie.name}\n${cookie.domain}\n${cookie.path}`, cookie);
  }
  const cookies = [...deduped.values()];
  const domains = [...domainCounts.entries()]
    .map(([domain, count]) => ({
      domain,
      count,
      matchesProfile: target.hostname === domain || target.hostname.endsWith(`.${domain}`),
    }))
    .sort((a, b) => Number(b.matchesProfile) - Number(a.matchesProfile) || b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, 50);

  return {
    target,
    format: extracted.format,
    totalCookies: extracted.cookies.length,
    validCookies,
    matchingCookies: cookies.length,
    expiredCookies,
    invalidCookies,
    ignoredCookies: Math.max(0, validCookies - matching.length),
    domains,
    cookies,
  };
}

export function buildImportedCookieMaterial(profile: any, jsonValue: any) {
  const inspected = inspectCookieImport(String(profile?.url || ''), jsonValue);
  if (inspected.matchingCookies < 1) {
    const available = inspected.domains.slice(0, 8).map((item) => item.domain).join(', ');
    fail(
      409,
      'COOKIE_IMPORT_NO_MATCH',
      available
        ? `El JSON no contiene cookies aplicables a ${inspected.target.hostname}. Dominios encontrados: ${available}.`
        : `El JSON no contiene cookies válidas aplicables a ${inspected.target.hostname}.`,
    );
  }

  const now = new Date().toISOString();
  const material = {
    format: 'userflex-browser-session-v2',
    profileId: String(profile?.id || ''),
    allowedOrigin: inspected.target.origin,
    capturedUrl: inspected.target.toString(),
    capturedAt: now,
    source: {
      type: 'json-cookie-import',
      format: inspected.format,
    },
    network: { mode: 'imported-cookie-json' },
    cookies: inspected.cookies,
    storage: {
      origin: inspected.target.origin,
      href: inspected.target.toString(),
      localStorage: {},
      sessionStorage: {},
      indexedDB: [],
    },
  };

  validateCapturedMaterialData(profile, material);
  return { material, inspection: inspected };
}
