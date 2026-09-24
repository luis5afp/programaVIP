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
  /return 0;/,
  'legacy Keeper request endpoints must remain passive',
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
assert.doesNotMatch(app, /api\.profileSessions\.requestChecks\(\)/);

assert.match(clientMain, /requestSessionKeeperChecks/);
assert.match(clientMain, /\/api\/client\/session-checks\/request/);
assert.ok((clientMain.match(/void requestSessionKeeperChecks\(\)/g) || []).length >= 2);

assert.equal(managerPackage.dependencies?.['@supabase/realtime-js'], undefined);
assert.doesNotMatch(manager, /@supabase\/realtime-js|RealtimeClient|supabase\.co/i);
assert.doesNotMatch(manager, /queueKeeperCheck|runRequestedKeeperChecks|connectKeeperRealtime/);
assert.match(manager, /configureKeeperStartup\(false\)/);
assert.doesNotMatch(
  manager,
  /if \(hasKeepers\)[\s\S]{0,120}scheduleKeeper\(\)/,
  'Session Manager must not start periodic Keeper checks',
);

console.log('Keeper endpoints passive; access is revoked only by real client failures: OK');
