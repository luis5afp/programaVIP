import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../cloudflare/lib/client-updates.ts', import.meta.url), 'utf8');

assert.match(source, /const UPSTREAM_ATTEMPTS = 3/, 'must retry transient Supabase failures');
assert.match(source, /const UPSTREAM_TIMEOUT_MS = 10_000/, 'upstream attempts must be bounded while tolerating slower storage reads');
assert.match(source, /url\.search = ''/, 'legacy cache-busting query strings must normalize');
assert.match(source, /latestMemoryCache/, 'latest manifest needs a warm memory cache');
assert.match(source, /caches\?\.default|caches\?\./, 'latest manifest needs edge cache support');
assert.match(source, /validateLatestManifest\(body\)/, 'manifest must be validated before serving');
assert.match(source, /new Uint8Array\(await upstream\.arrayBuffer\(\)\)/, 'chunks must be fully buffered before delivery');
assert.match(source, /UPDATE_CHUNK_LENGTH_MISMATCH/, 'chunk length must be verified');
assert.match(source, /X-Userflex-Update-Source/, 'responses should expose a diagnostic source header');
assert.ok(source.includes("if (url.pathname === '/api/client-update/latest')"), 'latest route must exist');
assert.ok(source.includes('return latestManifest(request, env);'), 'latest route must use hardened delivery');
assert.ok(source.includes('return chunkResponse(env, `versions/${version}/${part}`);'), 'chunk route must use buffered delivery');

console.log('Legacy updater compatibility route: OK');
