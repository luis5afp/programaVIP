import * as electron from 'electron';

const components = electron.components;
let readinessPromise = null;
let lastStatus = null;
let lastError = null;

function normalizeError(error) {
  return error?.message || String(error || 'Widevine unavailable');
}

function componentStatus() {
  try {
    return typeof components?.status === 'function' ? components.status() : null;
  } catch {
    return null;
  }
}

export function widevineRuntimeAvailable() {
  return Boolean(components && typeof components.whenReady === 'function');
}

export function prewarmWidevine() {
  if (readinessPromise) return readinessPromise;
  if (!widevineRuntimeAvailable()) {
    lastError = 'WIDEVINE_COMPONENT_API_UNAVAILABLE';
    readinessPromise = Promise.resolve(false);
    return readinessPromise;
  }

  readinessPromise = components.whenReady()
    .then(() => {
      lastStatus = componentStatus();
      lastError = null;
      return true;
    })
    .catch((error) => {
      lastStatus = componentStatus();
      lastError = normalizeError(error);
      return false;
    });
  return readinessPromise;
}

export async function ensureWidevineReady(timeoutMs = 12_000) {
  const ready = prewarmWidevine();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return ready;

  let timer = null;
  try {
    return await Promise.race([
      ready,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function widevineDiagnostics() {
  return {
    available: widevineRuntimeAvailable(),
    status: lastStatus ?? componentStatus(),
    error: lastError,
  };
}

const configuredSessions = new WeakSet();

function secureRequestOrigin(value) {
  try {
    return new URL(String(value || '')).protocol === 'https:';
  } catch {
    return false;
  }
}

export function enableProtectedContentForSession(browserSession) {
  if (!browserSession || configuredSessions.has(browserSession)) return;
  configuredSessions.add(browserSession);

  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'mediaKeySystem') {
      // Preserve Electron's current default permission behavior for permissions
      // unrelated to protected media. userFLOW only specializes DRM here.
      callback(true);
      return;
    }

    const requestUrl = details?.requestingUrl || details?.requestingOrigin || webContents?.getURL?.() || '';
    callback(secureRequestOrigin(requestUrl));
  });

  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== 'mediaKeySystem') return true;
    const requestUrl = requestingOrigin || details?.requestingUrl || webContents?.getURL?.() || '';
    return secureRequestOrigin(requestUrl);
  });
}
