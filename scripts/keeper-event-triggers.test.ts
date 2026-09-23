import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const keeper = readFileSync(new URL('../cloudflare/lib/keeper-revalidation.ts', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../cloudflare/lib/admin.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const clientMain = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const managerPackage = JSON.parse(readFileSync(new URL('../session-manager/package.json', import.meta.url), 'utf8'));

assert.doesNotMatch(keeper, /supabase|realtime|broadcast/i);
assert.match(keeper, /requestKeeperChecks/);
assert.match(keeper, /return 0;/);
assert.match(
  keeper,
  /Session Manager performs low-frequency round-robin Keeper checks locally/,
  'Keeper requests must remain passive without a third-party realtime provider',
);

assert.match(sessions, /\/api\/profile-session-checks\/request/);
assert.match(sessions, /requestAllKeeperChecks\(env, 'admin-start'\)/);
assert.match(sessions, /\/api\/session-keeper\/realtime/);
assert.match(sessions, /realtime: null/);
assert.match(sessions, /requestKeeperChecks\(env, \[profileId\], 'credentials-update'\)/);

assert.match(client, /export async function clientRequestSessionChecks/);
assert.match(client, /requestKeeperChecks\(env, profileIds, 'client-start'\)/);
assert.match(worker, /\/api\/client\/session-checks\/request/);

assert.match(admin, /requestKeeperChecks\(env, \[profileId\], 'profile-update'\)/);
assert.match(admin, /!invalidateSnapshot && nextSnapshot/);

assert.match(api, /requestChecks: \(\) => request/);
assert.match(app, /api\.profileSessions\.requestChecks\(\)/);

assert.match(clientMain, /requestSessionKeeperChecks/);
assert.match(clientMain, /\/api\/client\/session-checks\/request/);
assert.ok((clientMain.match(/void requestSessionKeeperChecks\(\)/g) || []).length >= 2);

assert.equal(managerPackage.dependencies?.['@supabase/realtime-js'], undefined);
assert.doesNotMatch(manager, /@supabase\/realtime-js|RealtimeClient|supabase\.co/i);
assert.doesNotMatch(manager, /queueKeeperCheck|runRequestedKeeperChecks|connectKeeperRealtime/);
assert.match(manager, /KEEPER_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
assert.match(manager, /const KEEPER_INITIAL_DELAY_MS = KEEPER_INTERVAL_MS/);
assert.match(manager, /keeperCycleCursor/);
assert.match(
  manager,
  /periodic cycle checks one[\s\S]{0,160}round-robin cursor to keep server usage low/,
  'Session Manager must retain low-frequency round-robin Keeper checks',
);

console.log('Keeper low-frequency checks without Supabase Realtime: OK');
