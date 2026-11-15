import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalAuthFile, previousAuthFiles } from '../client-app/auth-session-locations.js';

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

const source = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
assert.match(source, /canonicalAuthFile\(app\.getPath\('appData'\)\)/);
assert.match(source, /if \(!restored\.ok && restored\.reason === 'MISSING'\)/,
  'migration only runs when the stable cache is missing, not when invalidated');
assert.match(source, /await saveAuth\(old\.token, old\.meta\)/,
  'migration must verify the encrypted token in its canonical location');
assert.match(source, /for \(const file of \[authPath\(\), \.\.\.previousAuthPaths\(\)\]\)/,
  'logout must delete canonical and legacy tokens, preventing resurrection');
assert.doesNotMatch(startup, /await copyIdentityFile\('auth\.json'\)/,
  'startup must not duplicate encrypted token after explicit logout');
assert.match(server, /createdAt: sessionCreatedAt/,
  'the server must send the original session issue timestamp');
assert.match(catalog, /sessionCreatedAt: id\.sessionCreatedAt/,
  'catalog must return the same original creation timestamp after restart');
assert.match(catalog, /sessionExpiresAt: id\.sessionExpiresAt/,
  'catalog must return exact original expiry without extending it');
console.log('userFLOW canonical session location and migration/logout: OK');
