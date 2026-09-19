import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /await validateProxy\(\{[\s\S]*host: proxy\.host,[\s\S]*port: Number\(proxy\.port\)/,
  'session capture must perform a live proxy validation before launch',
);
assert.match(
  source,
  /const storedProxy = await captureProxyForProfile\(env, profile\);[\s\S]*await liveValidateCaptureProxy\(env, storedProxy\)/,
  'capture flow must validate the selected proxy before issuing browser bootstrap data',
);
assert.match(
  source,
  /PROFILE_PROXY_UNAVAILABLE[\s\S]*El proxy/,
  'failed live validation must return an actionable profile proxy error',
);

console.log('Capture proxy live validation regression: OK');
