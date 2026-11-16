import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalAuthFile, previousAuthFiles } from '../client-app/auth-session-locations.js';
import { selectPersistentUserData } from '../client-app/user-data-location.js';

const appData = path.join('C:', 'Users', 'Test', 'AppData', 'Roaming');
const firstLaunch = path.join(appData, 'userFLOW');
const renamedLaunch = path.join(appData, 'userflow-client');
const stable = canonicalAuthFile(appData);
assert.equal(stable, path.join(appData, 'userFLEX Client', 'auth.json'),
  'auth token must not depend on Electron executable/product name');
assert.equal(canonicalAuthFile(appData), canonicalAuthFile(appData),
  'stable token path must remain unchanged after every launch');
assert.ok(previousAuthFiles(appData, firstLaunch).includes(path.join(firstLaunch, 'auth.json')),
  'sessions saved before the fix must be discoverable');
assert.ok(previousAuthFiles(appData, renamedLaunch).includes(path.join(renamedLaunch, 'auth.json')),
  'renamed app must not hide previous auth cache');
assert.ok(!previousAuthFiles(appData, firstLaunch).includes(stable),
  'never treat canonical auth as a migration source');

const testRoot = mkdtempSync(path.join(tmpdir(), 'userflow-stable-root-'));
try {
  const first = path.join(testRoot, 'userFLOW');
  const second = path.join(testRoot, 'userflow-client');
  mkdirSync(first);
  mkdirSync(second);
  const chosenOnLogin = selectPersistentUserData(testRoot, first);
  const chosenOnReopen = selectPersistentUserData(testRoot, second);
  assert.equal(chosenOnLogin, chosenOnReopen,
    'startup must reuse the same safeStorage/Chromium root even after app rename');
} finally {
  rmSync(testRoot, { recursive:true, force:true });
}

const source = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');
assert.match(startup, /selectPersistentUserData\(app\.getPath\('appData'\), app\.getPath\('userData'\)\)/,
  'startup must select the persistent encryption root before Electron is ready');
const server = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
assert.match(source, /canonicalAuthFile\(app\.getPath\('appData'\)\)/);
assert.match(source, /await recoverAuthCopies\(\{/,
  'migration must test primary, encrypted backups and older auth locations');
assert.match(source, /await saveAuth\(restored\.token, restored\.meta\)/,
  'recovery must verify the encrypted token in its canonical location');
assert.match(source, /new Set\(\[authPath\(\), \.\.\.authBackupPaths\(\), \.\.\.previousAuthPaths\(\)\]\)/,
  'logout must delete canonical, recovery and legacy tokens, preventing resurrection');
assert.doesNotMatch(startup, /await copyIdentityFile\('auth\.json'\)/,
  'startup must not duplicate encrypted token after explicit logout');
assert.match(server, /createdAt: sessionCreatedAt/,
  'the server must send the original session issue timestamp');
assert.match(catalog, /sessionCreatedAt: id\.sessionCreatedAt/,
  'catalog must return the same original creation timestamp after restart');
assert.match(catalog, /sessionExpiresAt: id\.sessionExpiresAt/,
  'catalog must return exact original expiry without extending it');
console.log('userFLOW canonical session location and migration/logout: OK');
