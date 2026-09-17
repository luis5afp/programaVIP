import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');

const hardenedCookieHelper = `function cookieSetPayload(cookie, fallbackUrl, relaxed = false) {
  const fallback = new URL(fallbackUrl);
  const domain = typeof cookie.domain === 'string' && cookie.domain.trim() ? cookie.domain.trim() : fallback.hostname;
  const host = domain.replace(/^\\./, '');
  const secure = cookie.secure !== false;
  const cookiePath = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
  const value = {
    url: (secure ? 'https:' : 'http:') + '//' + host + cookiePath,
    name: String(cookie.name || ''),
    value: String(cookie.value || ''),
    path: cookiePath,
    secure,
    httpOnly: cookie.httpOnly === true,
  };
  if (domain && cookie.hostOnly !== true) value.domain = relaxed ? host : domain;
  if (typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) value.expirationDate = cookie.expirationDate;
  if (!relaxed && ['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) value.sameSite = cookie.sameSite;
  return value;
}

function cookieDomainMatchesHost(cookie, hostname) {
  const host = String(hostname || '').toLowerCase();
  const domain = String(cookie?.domain || host).replace(/^\\./, '').toLowerCase();
  return Boolean(domain && (host === domain || host.endsWith('.' + domain)));
}

function isNetflixHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'netflix.com' || host.endsWith('.netflix.com');
}`;

if (!source.includes('function cookieDomainMatchesHost(')) {
  const helperPattern = /function cookieSetPayload\(cookie, fallbackUrl\) \{[\s\S]*?\n\}/;
  if (!helperPattern.test(source)) throw new Error('Could not locate cookieSetPayload in main.js');
  source = source.replace(helperPattern, hardenedCookieHelper);
}

const originalRestore = `  await browserSession.clearStorageData({ storages: ['cookies'] });
  const cookies = Array.isArray(material.cookies) ? material.cookies : [];
  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    try {
      await browserSession.cookies.set(cookieSetPayload(cookie, profile.url));
    } catch {
      // Ignore an individual expired/invalid cookie while restoring the rest.
    }
  }

  await webContents.loadURL(profile.url);`;

const hardenedRestore = `  await browserSession.clearStorageData({ storages: ['cookies'] });
  const cookies = Array.isArray(material.cookies) ? material.cookies : [];
  const targetHost = new URL(profile.url).hostname.toLowerCase();
  const targetCookies = cookies.filter((cookie) => cookie?.name && cookieDomainMatchesHost(cookie, targetHost));
  const restoreFailures = [];
  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    try {
      await browserSession.cookies.set(cookieSetPayload(cookie, profile.url));
    } catch (firstError) {
      try {
        await browserSession.cookies.set(cookieSetPayload(cookie, profile.url, true));
      } catch (secondError) {
        restoreFailures.push({ name: String(cookie.name || ''), error: secondError instanceof Error ? secondError.message : String(secondError || firstError || '') });
      }
    }
  }
  const installedCookies = await browserSession.cookies.get({ url: profile.url });
  const installedByName = new Map(installedCookies.map((cookie) => [String(cookie.name || '').toLowerCase(), cookie]));
  const targetNames = new Set(targetCookies.map((cookie) => String(cookie.name || '').toLowerCase()));
  if (targetNames.size > 0 && ![...targetNames].some((name) => installedByName.has(name))) {
    throw new UserflexError('La sesión llegó al cliente, pero Chromium no pudo instalar sus cookies.', 'SESSION_COOKIE_RESTORE_FAILED');
  }
  if (isNetflixHost(targetHost)) {
    const capturedAuth = new Map(targetCookies.filter((cookie) => ['netflixid', 'securenetflixid'].includes(String(cookie.name || '').toLowerCase())).map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value || '')]));
    const missingAuth = [];
    for (const name of ['netflixid', 'securenetflixid']) {
      if (!capturedAuth.has(name)) continue;
      const installed = installedByName.get(name);
      if (!installed || String(installed.value || '') !== capturedAuth.get(name)) missingAuth.push(name);
    }
    if (missingAuth.length) throw new UserflexError('No se pudieron restaurar las cookies de autenticación de Netflix (' + missingAuth.join(', ') + '). Vuelve a capturar la sesión.', 'NETFLIX_AUTH_COOKIE_RESTORE_FAILED');
  }
  if (restoreFailures.length && installedCookies.length === 0) {
    throw new UserflexError('Chromium rechazó las cookies de la sesión administrada.', 'SESSION_COOKIE_RESTORE_FAILED');
  }

  await webContents.loadURL(profile.url);`;

if (!source.includes('const installedCookies = await browserSession.cookies.get({ url: profile.url });')) {
  if (!source.includes(originalRestore)) throw new Error('Could not locate managed cookie restore block in main.js');
  source = source.replace(originalRestore, hardenedRestore);
}

if (!source.includes('NETFLIX_AUTH_COOKIE_RESTORE_FAILED')) throw new Error('Managed cookie restore patch was not applied');
fs.writeFileSync(mainPath, source);
console.log('Applied managed cookie transfer verification.');
