import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const revalidation = readFileSync(new URL('../cloudflare/lib/client-revalidation.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../cloudflare/lib/admin.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

assert.match(
  main,
  /const HEARTBEAT_MS = 12 \* 60 \* 60 \* 1000/,
  'normal client heartbeat fallback must be 12 hours',
);
assert.doesNotMatch(
  main,
  /setInterval\(\(\) => void runHeartbeat\('60s'\)/,
  'the old one-minute heartbeat loop must be removed',
);
assert.match(
  main,
  /import \{ RealtimeClient \} from '@supabase\/realtime-js'/,
  'desktop client must use the supported Supabase Realtime client',
);
assert.match(
  main,
  /\.on\('broadcast', \{ event: config\.event \},[\s\S]{0,300}runHeartbeat\('config-event'\)/,
  'a server configuration event must trigger immediate revalidation',
);
assert.match(
  main,
  /scheduleHeartbeat\(HEARTBEAT_MS, '12h'\)/,
  'userFLOW must retain a 12-hour safety validation',
);
assert.doesNotMatch(
  main,
  /void runHeartbeat\('startup'\)/,
  'bootstrap catalog validation must not be followed by a duplicate startup heartbeat',
);
assert.match(
  client,
  /realtime[,\s]*minimumClientVersion/,
  'catalog response must include per-client Realtime metadata',
);
assert.match(
  revalidation,
  /\/realtime\/v1\/api\/broadcast/,
  'admin changes must use Realtime Broadcast instead of polling all clients',
);
assert.match(
  revalidation,
  /userflex-config:\$\{digest\}/,
  'client notification topics must be unguessable per-client topics',
);
assert.match(
  admin,
  /touchClientConfig\(env, clientId\)/,
  'assignment and client changes must advance client configuration revision',
);
assert.match(
  wrangler,
  /SUPABASE_PUBLISHABLE_KEY = "sb_publishable_/,
  'desktop Realtime subscriptions require the public Supabase key',
);

console.log('Event-driven client heartbeat: OK');
