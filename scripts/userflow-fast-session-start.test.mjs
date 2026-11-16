import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../client-app/preload.cjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../client-app/index.html', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));
const startupHandoff = await import('../client-app/startup-window-handoff.js');
const finalizer = readFileSync(new URL('../client-app/build/finalize-client-ui.mjs', import.meta.url), 'utf8');

const at = (start, end) => {
  const a = main.indexOf(start);
  const b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Source segment missing: ' + start);
  return main.slice(a, b);
};
const bootstrap = at("ipcMain.handle('userflex:bootstrap'", "ipcMain.handle('userflex:login'");
const catalog = at('async function catalog(options = {})', 'function serializeError');
const images = at('function catalogWithoutImageDelay', 'async function apiBinaryRequest');
const launch = at('async function openProfile(profileId)', 'const launch = await apiRequest');

assert.match(main, /const FAST_SESSION_VERIFY_TIMEOUT_MS = 6_000/,
  'first check must have a bounded 6-second network timeout');
assert.match(main, /maxAttempts = retryable[\s\S]*configuredAttempts/,
  'request helper must accept an explicit attempt limit');
assert.match(catalog, /quickVerify[\s\S]*maxAttempts: 1/,
  'initial token check must perform only one network request');
assert.match(catalog, /sessionRetry[\s\S]*timeout: 8_000, maxAttempts: 2/,
  'manual retry may be slower but must remain bounded');
assert.match(catalog, /await apiRequest\('\/api\/client\/catalog', requestOptions\)/,
  'remote token validation must still happen before catalog access');
assert.match(catalog, /if \(options\.deferImages\) return catalogWithoutImageDelay\(payload\)/,
  'server-authorized catalog must be returned without waiting for logos');
assert.match(images, /profileImageDataCache\.get/,
  'cached icons can display instantly');
assert.match(images, /void profileImageDataUrl\(sourceUrl[\s\S]*sendClient\('userflex:profile-image'/,
  'uncached icons must be downloaded after authorization and sent asynchronously');
assert.match(bootstrap, /await catalog\(\{[\s\S]*?quickVerify: input\?\.retry !== true[\s\S]*?deferImages: true/,
  'initial bootstrap must select the fast catalog path');
assert.match(bootstrap, /mergeValidationMeta\(data\)/,
  '24-hour token expiry must be synchronized before entering the workspace');
assert.match(bootstrap, /scheduleInitialCatalogSync\(data, 'bootstrap'\)/,
  'local security reconciliation must run, not be omitted');
assert.match(launch, /if \(initialCatalogSyncPromise\) await initialCatalogSyncPromise/,
  'no browser profile may launch before security reconciliation finishes');
assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?createMainWindow\(\)/,
  'the initial window must not wait for the Windows device ID lookup');
assert.doesNotMatch(bootstrap, /await hydrateCatalogProfileImages/,
  'bootstrap must never wait for remote images');
assert.match(preload, /onProfileImage:\s*\(callback\)/,
  'isolated preload must support safe asynchronous image updates');
assert.match(renderer, /window\.userflex\.onProfileImage\?\./,
  'renderer must accept streamed profile icons');
assert.match(renderer, /bootstrap\(\{ retry \}\)/,
  'manual retry must be distinct from the fast initial attempt');
assert.match(renderer, /retrySessionButton\.addEventListener\('click', \(\) => void restoreSavedSession\(true\)\)/);
assert.match(finalizer, /onProfileImage: \(\) => \(\) => \{\}/,
  'renderer bridge fallback must remain compatible');
assert.match(bootstrap, /pending: true/,
  'network errors must keep the encrypted token and show retry, not login');
// Startup has exactly one online catalog validation: the embedded view is
// allowed to reuse only the response held in memory after server approval.
assert.match(bootstrap, /event\.sender === catalogView\.webContents/);
assert.match(bootstrap, /serverVerifiedCatalog/);
assert.match(bootstrap, /expiresAt > estimatedServerNow\(authMeta\)/);
assert.match(bootstrap, /if \(accessToken\) createBrowserWindow\(\)/,
  'the native shell should warm while the one online request is running');
assert.match(main, /serverVerifiedCatalog = data/g);
const workspace = at('function revealVerifiedWorkspace()', 'async function returnToLogin(');
assert.match(workspace, /!browserShellReady \|\| !catalogContentReady/);
assert.match(workspace, /catalogContentReady/);
assert.match(workspace, /browserWindow\.show\(\)/);
assert.match(workspace, /mainWindow\.close\(\)/);
assert.match(main, /show: false,[\s\S]*backgroundColor: '#080b10'/,
  'auth UI must remain hidden while a saved session is being checked');
assert.match(main, /ipcMain\.handle\('userflex:reveal-auth-window'/);
assert.match(main, /ipcMain\.handle\('userflex:catalog-ready'/);
assert.match(preload, /revealAuthWindow:\s*\(\) => ipcRenderer\.invoke\('userflex:reveal-auth-window'\)/);
assert.match(preload, /catalogReady:\s*\(\) => ipcRenderer\.invoke\('userflex:catalog-ready'\)/);
assert.match(renderer, /queueMicrotask\(\(\) => void window\.userflex\.catalogReady\?\.\(\)\)/);
assert.doesNotMatch(renderer, /requestAnimationFrame\(\(\) => void window\.userflex\.catalogReady/,
  'a hidden Electron window must not wait for requestAnimationFrame to signal catalog readiness');
assert.match(renderer, /window\.userflex\.revealAuthWindow\?\.\(\)/);
assert.match(html, /id="loading-view"/, 'offline retries must remain available');
// A hidden Electron login window must NEVER make the already visible splash
// disappear. The splash retires only when a destination window is shown.
const startup = updater.slice(updater.indexOf('async function startMain()'),
  updater.indexOf('function validateManifest('));
assert.match(startup, /await import\('\.\/main\.js'\)/);
assert.match(startup, /await waitForMainWindow\(\)/);
assert.doesNotMatch(startup, /splashWindow\.close\(\)/,
  'creating hidden login must not dismiss the currently visible startup window');
assert.match(updater, /registerStartupWindowHandoff\(\(\) =>/);
assert.match(updater, /splashWindow === splash && !splash\.isDestroyed\(\)/);
assert.match(main, /browserWindow\.show\(\);\s*browserWindow\.focus\(\);\s*completeStartupWindowHandoff\(\)/);
assert.match(main, /mainWindow\.show\(\);\s*mainWindow\.focus\(\);\s*completeStartupWindowHandoff\(\)/);
assert.match(main, /authWindow\.show\(\);\s*completeStartupWindowHandoff\(\)/);
assert.ok(packageJson.build.files.includes('startup-window-handoff.js'),
  'handoff module must be packaged in Windows installer');
let handoffCount = 0;
assert.equal(startupHandoff.completeStartupWindowHandoff(), false);
startupHandoff.registerStartupWindowHandoff(() => { handoffCount += 1; });
assert.equal(startupHandoff.completeStartupWindowHandoff(), true);
assert.equal(startupHandoff.completeStartupWindowHandoff(), false);
assert.equal(handoffCount, 1, 'startup can only complete its visible handoff once');
console.log('userFLOW fast secure startup and continuous visible window handoff: OK');
