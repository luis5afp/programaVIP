import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921130000_userflex_session_keeper.sql', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const captureState = readFileSync(new URL('../session-manager/browser-engine/capture-state.js', import.meta.url), 'utf8');
const clientEngine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const clientMain = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const profilesView = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.userflex_session_keepers/);
assert.match(migration, /create table if not exists public\.userflex_profile_session_versions/);
assert.match(migration, /enable row level security/);

assert.match(sessions, /userflex-session-keeper:\$\{rawToken\}/);
assert.match(sessions, /\/api\/session-keeper\/bootstrap/);
assert.match(sessions, /\/api\/session-keeper\/complete/);
assert.match(sessions, /if \(!authenticated\)[\s\S]{0,1200}last_status: 'needs_admin'/);
assert.match(sessions, /validatedAt: now/);
assert.match(sessions, /archiveCurrentSession/);
assert.match(sessions, /slice\(3\)/);
assert.match(worker, /path\.startsWith\('\/api\/session-keeper\/'\)/);
assert.match(worker, /session-fallback/);
assert.match(sessions, /notifyClients !== false/);
assert.match(sessions, /userflex_session_keepers\?profile_id=eq\.\$\{profileId\}[\s\S]{0,260}method: 'DELETE'/);
assert.match(sessions, /KEEPER_DISABLED/);

assert.match(manager, /safeStorage\.encryptString/);
assert.match(manager, /safeStorage\.decryptString/);
assert.match(manager, /const KEEPER_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
assert.match(manager, /setLoginItemSettings/);
assert.match(manager, /args: enabled === true \? \['--keeper'\] : \[\]/);
assert.match(manager, /background: true/);
assert.match(manager, /authenticated: false/);
assert.match(manager, /await engine\(\)\.saveActive\(\)/);
assert.match(manager, /completed\?\.keeper_token/);
assert.match(manager, /if \(engine\(\)\.active\)[\s\S]{0,180}captura manual activa/);

assert.match(captureState, /export async function inspectCaptureSession/);
assert.match(captureState, /loginActionVisible/);
assert.match(captureState, /authenticated,/);

assert.doesNotMatch(
  clientEngine,
  /Number\(sessionMarker\?\.version \|\| 0\) === desiredSessionVersion/,
  'new central snapshots must not automatically destroy a healthy local profile',
);
assert.doesNotMatch(
  clientEngine,
  /markerVersion !== desiredVersion/,
  'catalog reconciliation must preserve healthy local session generations',
);
assert.match(clientEngine, /Number\(sessionMarker\?\.version \|\| 0\) > 0/);

assert.match(clientMain, /preserveProfilesForAuthError/);
assert.match(clientMain, /clientId && !preserveProfiles/);
assert.match(clientMain, /session-fallback/);
assert.match(clientMain, /fallbackRecovered/);
assert.match(clientMain, /sessionVersion: Number\(result\?\.sessionVersion/);

assert.match(profilesView, /Keeper: activo/);
assert.match(profilesView, /Keeper: requiere acceso/);
assert.match(profilesView, /Keeper: pendiente/);

console.log('Session Keeper architecture: OK');
