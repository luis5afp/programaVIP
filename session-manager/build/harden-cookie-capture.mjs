import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');

const cookiesAnchor = `  const cookies = await browserSession.cookies.get({});
  const storage = await browserWindow.webContents.executeJavaScript`;
const cookiesReplacement = `  const cookies = await browserSession.cookies.get({});
  const profileHost = new URL(profile.url).hostname.toLowerCase();
  const cookieMatchesProfile = (cookie) => {
    const domain = String(cookie?.domain || profileHost).replace(/^\\./, '').toLowerCase();
    return Boolean(domain && (profileHost === domain || profileHost.endsWith('.' + domain)));
  };
  const cookieIsActive = (cookie) => !Number.isFinite(cookie?.expirationDate) || Number(cookie.expirationDate) > (Date.now() / 1000);
  const profileCookies = cookies.filter((cookie) => cookie?.name && cookieMatchesProfile(cookie) && cookieIsActive(cookie));
  const isNetflix = profileHost === 'netflix.com' || profileHost.endsWith('.netflix.com');
  let netflixAuthVerified = false;
  if (isNetflix) {
    const names = new Set(profileCookies.map((cookie) => String(cookie.name || '').toLowerCase()));
    const missing = ['netflixid', 'securenetflixid'].filter((name) => !names.has(name));
    if (missing.length) {
      throw new Error('Netflix todavía no tiene las cookies de autenticación activas (NetflixId y SecureNetflixId). Inicia sesión completamente y vuelve a guardar.');
    }
    netflixAuthVerified = true;
  }

  const storage = await browserWindow.webContents.executeJavaScript`;

if (!source.includes('let netflixAuthVerified = false;')) {
  if (!source.includes(cookiesAnchor)) throw new Error('Could not locate cookie capture anchor in Session Manager main.js');
  source = source.replace(cookiesAnchor, cookiesReplacement);
}

const cookieFieldsAnchor = `      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate,`;
const cookieFieldsReplacement = `      httpOnly: cookie.httpOnly,
      hostOnly: cookie.hostOnly,
      session: cookie.session,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate,`;
if (!source.includes('hostOnly: cookie.hostOnly')) {
  if (!source.includes(cookieFieldsAnchor)) throw new Error('Could not locate serialized cookie fields in Session Manager main.js');
  source = source.replace(cookieFieldsAnchor, cookieFieldsReplacement);
}

const networkAnchor = `    network: { mode: networkMode },
    cookies: cookies.map((cookie) => ({`;
const networkReplacement = `    network: { mode: networkMode },
    captureDiagnostics: {
      cookieCount: cookies.length,
      profileCookieCount: profileCookies.length,
      netflixAuthVerified,
    },
    cookies: cookies.map((cookie) => ({`;
if (!source.includes('captureDiagnostics: {')) {
  if (!source.includes(networkAnchor)) throw new Error('Could not locate material network block in Session Manager main.js');
  source = source.replace(networkAnchor, networkReplacement);
}

const returnAnchor = `  const completed = await apiPost(endpoint, '/api/session-manager/complete', { token, publicIp, material });
  browserWindow.webContents.send('userflex:saved', { version: completed.version, publicIp: completed.public_ip || publicIp });
  return { ok: true, version: completed.version, publicIp: completed.public_ip || publicIp };`;
const returnReplacement = `  const completed = await apiPost(endpoint, '/api/session-manager/complete', { token, publicIp, material });
  const saveResult = {
    version: completed.version,
    publicIp: completed.public_ip || publicIp,
    cookieCount: profileCookies.length,
    netflixAuthVerified,
  };
  browserWindow.webContents.send('userflex:saved', saveResult);
  return { ok: true, ...saveResult };`;
if (!source.includes('cookieCount: profileCookies.length')) {
  if (!source.includes(returnAnchor)) throw new Error('Could not locate Session Manager completion block');
  source = source.replace(returnAnchor, returnReplacement);
}

if (!source.includes('NetflixId y SecureNetflixId')) throw new Error('Netflix auth-cookie validation was not applied');
fs.writeFileSync(mainPath, source);
console.log('Applied managed cookie capture validation.');
