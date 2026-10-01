import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
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

assert.match(main, /safeStorage\.encryptString\(JSON\.stringify\(\{[\s\S]{0,180}identifier[\s\S]{0,180}password/, 'quick-login credentials must be encrypted with Electron safeStorage');
assert.match(main, /loginCredentialsPath\(\)[\s\S]{0,220}login-credentials\.json/, 'quick-login credentials must use a dedicated local file');
assert.match(main, /await saveLoginCredentials\(identifier, password\)/, 'successful client login must refresh the encrypted quick-login cache');
const syncStart = main.indexOf('async function syncClientConfiguration(');
const syncEnd = main.indexOf('\nfunction clearHeartbeatTimer(', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'client configuration sync must be discoverable');
const syncSource = main.slice(syncStart, syncEnd);
const clientIdPos = syncSource.indexOf('const clientId = String(');
const authClientPos = syncSource.indexOf('authMeta?.client?.id', clientIdPos);
const reconcilePos = syncSource.indexOf('reconcileCatalogProfiles(clientId, catalogProfiles)', authClientPos);
assert.ok(
  clientIdPos >= 0 && authClientPos > clientIdPos && reconcilePos > authClientPos,
  'client configuration sync must resolve clientId locally before profile reconciliation',
);
assert.match(preload, /savedLogin:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('userflex:saved-login'\)/, 'renderer must read quick-login data only through preload IPC');
assert.match(html, /id="password-toggle"[\s\S]{0,120}>Ver<\/button>/, 'login form must provide a show/hide password control');
assert.match(renderer, /setPasswordVisible\(visible\)[\s\S]{0,260}passwordInput\.type = visible \? 'text' : 'password'/, 'password visibility control must toggle the input type');
assert.match(renderer, /applySavedLogin\(\)[\s\S]{0,520}performLogin\(\{ automatic: true \}\)/, 'saved encrypted credentials must restore the client session automatically');
assert.match(startup, /copyIdentityFile\('login-credentials\.json'\)/, 'updates must preserve the encrypted quick-login cache across stable userData migration');

console.log('Client login/window lifecycle regression: OK');
