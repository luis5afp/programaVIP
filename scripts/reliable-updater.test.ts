import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/build-client-app.yml', import.meta.url), 'utf8');

assert.doesNotMatch(
  String(pkg.scripts?.prestart || '') + String(pkg.scripts?.['predist:win'] || ''),
  /fail-open-updater/,
  'packaged userFLOW must not re-enable the silent fail-open updater',
);

assert.match(bootstrap, /const UPDATE_MANIFEST_ATTEMPTS = 3/, 'manifest check must retry');
assert.match(bootstrap, /const UPDATE_CHUNK_ATTEMPTS = 4/, 'chunk downloads must retry generously');
assert.match(bootstrap, /async function prepareUpdateDirectory\(\)/, 'updater needs writable-directory fallback');
assert.match(bootstrap, /app\.getPath\('temp'\)/, 'updater needs Windows temp fallback');
assert.match(bootstrap, /async function updaterLog\(message\)/, 'updater failures must be written to startup.log');
assert.match(bootstrap, /UPDATE_CHUNK_TIMEOUT_MS = 120_000/, 'chunk attempts need a bounded timeout that tolerates slow connections');
assert.match(bootstrap, /bloque \$\{index \+ 1\}\/\$\{manifest\.chunks\.length\}/, 'download status must show chunk progress');

const updateStart = bootstrap.indexOf('async function checkUpdatesAndContinue()');
const updateEnd = bootstrap.indexOf('\ncreateSplash();', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'updater flow must exist');
const updater = bootstrap.slice(updateStart, updateEnd);
const catchStart = updater.indexOf('} catch (error) {');
assert.ok(catchStart >= 0, 'updater catch must exist');
const updaterCatch = updater.slice(catchStart);
assert.doesNotMatch(updaterCatch, /await startMain\(\)/, 'update failure must stay visible instead of silently opening login');
assert.match(updaterCatch, /Actualización detenida/, 'update failure must show a visible diagnostic');
assert.match(updaterCatch, /Reintentar verificación/, 'update failure must offer a retry');

assert.match(workflow, /\$chunkSize = 4MB/, 'release feed must use smaller legacy-compatible chunks');

console.log('Reliable updater flow: OK');
