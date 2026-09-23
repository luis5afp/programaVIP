import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const revalidation = readFileSync(new URL('../cloudflare/lib/client-revalidation.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../cloudflare/lib/admin.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const clientPackage = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));

assert.match(
  main,
  /const HEARTBEAT_MS = 12 \* 60 \* 60 \* 1000/,
  'normal client safety heartbeat must remain low-frequency at 12 hours',
);
assert.doesNotMatch(main, /@supabase\/realtime-js|RealtimeClient|supabase\.co/i);
assert.equal(clientPackage.dependencies?.['@supabase/realtime-js'], undefined);
assert.doesNotMatch(client, /clientRealtimeConfig|realtime[,\s]/);
assert.doesNotMatch(revalidation, /supabase|realtime|broadcast/i);
assert.doesNotMatch(wrangler, /SUPABASE_|supabase\.co/i);

assert.match(
  main,
  /syncClientConfiguration\(launch, 'profile-launch'\)/,
  'opening a profile must revalidate current server configuration',
);
assert.match(
  main,
  /scheduleHeartbeat\(HEARTBEAT_MS, '12h'\)/,
  'userFLOW must retain a low-frequency server safety validation',
);
assert.match(
  revalidation,
  /body: JSON\.stringify\(\{ updated_at: revision \}\)/,
  'admin changes must still advance the client configuration revision in Neon',
);
assert.match(
  admin,
  /touchClientConfig\(env, clientId\)/,
  'assignment and client changes must advance client configuration revision',
);

console.log('Neon-only low-frequency client revalidation: OK');
