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

assert.match(keeper, /const KEEPER_EVENT = 'keeper_check'/);
assert.match(keeper, /userflex-keeper:\$\{profileId\}:\$\{secret\}/);
assert.match(keeper, /\/realtime\/v1\/api\/broadcast/);
assert.match(keeper, /KEEPER_REQUEST_COOLDOWN_MS = 5 \* 60 \* 1000/);
assert.match(keeper, /last_check_at/);
assert.match(keeper, /reason: 'admin-start' \| 'client-start' \| 'profile-update' \| 'credentials-update'/);

assert.match(sessions, /\/api\/profile-session-checks\/request/);
assert.match(sessions, /requestAllKeeperChecks\(env, 'admin-start'\)/);
assert.match(sessions, /\/api\/session-keeper\/realtime/);
assert.match(sessions, /keeperRealtimeConfig\(env, keeper\.profile_id\)/);
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

assert.equal(managerPackage.dependencies['@supabase/realtime-js'], '^2.99.2');
assert.match(manager, /import \{ RealtimeClient \} from '@supabase\/realtime-js'/);
assert.match(manager, /\/api\/session-keeper\/realtime/);
assert.match(manager, /queueKeeperCheck/);
assert.match(manager, /runRequestedKeeperChecks/);
assert.match(manager, /KEEPER_EVENT_COOLDOWN_MS = 5 \* 60 \* 1000/);
assert.match(manager, /KEEPER_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
assert.match(manager, /void connectKeeperRealtime\(\)/);

console.log('Keeper event triggers: OK');
