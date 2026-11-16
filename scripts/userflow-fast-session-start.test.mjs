import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../client-app/preload.cjs', import.meta.url), 'utf8');
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
console.log('userFLOW fast secure bootstrap (6-second initial check, deferred images, launch guard): OK');
