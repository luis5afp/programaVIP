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
