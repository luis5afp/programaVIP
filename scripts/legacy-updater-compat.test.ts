import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../cloudflare/lib/client-updates.ts', import.meta.url), 'utf8');

assert.match(source, /url\.search = ''/, 'legacy cache-busting query strings must normalize');
assert.match(source, /latestMemoryCache/, 'latest manifest needs a warm memory cache');
assert.match(source, /caches\?\.default|caches\?\./, 'latest manifest needs edge cache support');
assert.match(source, /validateLatestManifest\(body\)/, 'manifest must be validated before serving');
assert.match(source, /releaseBucket\(env\)\.get\('latest\.json'\)/, 'latest manifest must come from the R2 binding');
assert.match(source, /new Uint8Array\(await object\.arrayBuffer\(\)\)/, 'chunks must be fully buffered before delivery');
assert.match(source, /UPDATE_CHUNK_LENGTH_MISMATCH/, 'chunk length must be verified');
assert.match(source, /X-Userflex-Update-Source/, 'responses should expose a diagnostic source header');
assert.match(source, /cloudflare-r2/, 'delivery diagnostics must identify R2');
assert.ok(source.includes("if (url.pathname === '/api/client-update/latest')"), 'latest route must exist');
assert.ok(source.includes('return latestManifest(request, env);'), 'latest route must use hardened delivery');
assert.ok(source.includes('return chunkResponse(env, `versions/${version}/${part}`);'), 'chunk route must use buffered delivery');

console.log('Legacy updater compatibility route over R2: OK');
