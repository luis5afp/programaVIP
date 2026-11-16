import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const authCache = readFileSync(new URL('../client-app/auth-session-cache.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../client-app/preload.cjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../client-app/index.html', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');

const start = main.indexOf('async function returnToLogin(');
const end = main.indexOf('\nfunction proxyRules(', start);
assert.ok(start >= 0 && end > start, 'returnToLogin must be discoverable');
const transition = main.slice(start, end);

const clearPos = transition.indexOf('await clearAuth()');
const createPos = transition.indexOf('const loginWindow = createMainWindow()');
const closePos = transition.indexOf('closePrivateBrowser()');

assert.ok(clearPos >= 0, 'auth must be cleared when invalidated');
assert.ok(createPos > clearPos, 'login window must be created after auth is cleared');
assert.ok(closePos > createPos, 'workspace must close only after the login window exists');
assert.match(
  transition,
  /pendingAuthInvalidation\s*=\s*message/,
  'auth invalidation reason must be preserved for the newly created login renderer',
);

assert.match(
  worker,
  /path === '\/api\/client\/auth'[\s\S]{0,180}assertMinimumUserflowVersion\(request\)/,
  'outdated userFLOW must be rejected before client login succeeds',
);
assert.match(
  worker,
  /path === '\/api\/client\/catalog'[\s\S]{0,180}assertMinimumUserflowVersion\(request\)/,
  'outdated stored sessions must be rejected before entering the catalog',
);

const core = readFileSync(new URL('../cloudflare/lib/core.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');

assert.match(core, /CLIENT_SESSION_SECONDS = 24 \* 60 \* 60/, 'server token lifetime is 24 hours');
assert.match(auth, /Date\.parse\(sessionCreatedAt\) \+ CLIENT_SESSION_SECONDS \* 1000/,
  'client login creates a fixed 24-hour server expiration from creation time');
assert.match(auth, /revoked_at=is\.null&expires_at=gt/,
  'every validated token must be neither revoked nor expired');
assert.match(authCache, /encryption\.encryptString\(token\)/,
  'the issued token is encrypted locally with Electron safeStorage');
assert.match(main, /persistRecoverableAuth\(\{/,
  'main must save verified encrypted primary and recovery copies');
assert.match(main, /await recoverAuthCopies\(\{/,
  'reopening must check encrypted recovery if primary is missing');
assert.match(main, /async function loadAuth\(\)/,
  'valid encrypted token resumes login after restarting the app');
assert.match(authCache, /locallyExpired = Number\.isFinite\(expiresAt\)/,
  'local expiry is advisory until the server authorizes or revokes the token');
assert.match(main, /const data = await catalog\(\)/,
  'reopened sessions must validate the token online before entering profiles');
assert.match(main, /function scheduleAuthSessionExpiry\(\)/,
  'live sessions must expire even when no heartbeat is due');
assert.match(main, /await removeLegacyLoginCredentials\(\)/,
  'old auto-login password cache must be removed during upgrade');
assert.doesNotMatch(main, /saveLoginCredentials\(|loadLoginCredentials\(/,
  'userFLOW must never silently reauthenticate with a saved password');
const syncStart = main.indexOf('async function syncClientConfiguration(');
const syncEnd = main.indexOf('\nfunction clearHeartbeatTimer(', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'client configuration sync must be discoverable');
const syncSource = main.slice(syncStart, syncEnd);
const clientIdPos = syncSource.indexOf('const clientId = String(');
const authClientPos = syncSource.indexOf('authMeta?.client?.id', clientIdPos);
const reconcilePos = syncSource.indexOf('reconcileCatalogProfiles(clientId, catalogProfiles,', authClientPos);
assert.ok(
  clientIdPos >= 0 && authClientPos > clientIdPos && reconcilePos > authClientPos,
  'client configuration sync must resolve clientId locally before profile reconciliation',
);
assert.match(preload, /logout:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('userflex:logout'\)/,
  'renderer can request explicit logout through an isolated preload bridge');
assert.match(main, /ipcMain\.handle\('userflex:logout'[\s\S]*apiRequest\('\/api\/client\/logout', \{ method: 'POST' \}\)/,
  'logout must revoke the token on the server');
assert.match(client, /export async function clientLogout[\s\S]*revoked_at/,
  'backend must invalidate the current server session');
assert.match(html, /id="logout-button"/, 'there must be a visible Cerrar sesión control');
assert.match(renderer, /logoutButton\.addEventListener\('click'/,
  'Cerrar sesión must perform an actual logout');
assert.match(html, /id="password-toggle"[\s\S]{0,120}>Ver<\/button>/, 'login form must provide a show/hide password control');
assert.match(renderer, /setPasswordVisible\(visible\)[\s\S]{0,260}passwordInput\.type = visible \? 'text' : 'password'/, 'password visibility control must toggle the input type');
assert.doesNotMatch(renderer, /applySavedLogin\(|performLogin\(\{ automatic: true \}\)/,
  'expired sessions must ask for credentials instead of silently issuing a new token');
assert.doesNotMatch(startup, /copyIdentityFile\('login-credentials\.json'\)/,
  'old saved login passwords must not be restored from migration paths');
assert.doesNotMatch(startup, /copyIdentityFile\('auth\.json'\)/,
  'startup must not duplicate encrypted token files in temporary userData directories');
assert.match(main, /canonicalAuthFile\(app\.getPath\('appData'\)\)/,
  'the token must use a stable per-Windows-user location across launches');

console.log('Client login/window lifecycle regression: OK');
