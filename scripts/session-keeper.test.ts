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
assert.match(manager, /function manualCaptureBusy/);
assert.match(manager, /manualCaptureGeneration \+= 1/);
assert.match(manager, /manual_capture_priority/);
assert.match(manager, /const KEEPER_INITIAL_DELAY_MS = KEEPER_INTERVAL_MS/);
assert.match(manager, /const entries = Object\.entries\(registry\)[\s\S]{0,500}keeperCycleCursor/);
assert.match(
  manager,
  /if \(!interruptedByManualCapture\(\)\)[\s\S]{0,180}engine\(\)\.close\('keeper_check'\)/,
  'a stale Keeper task must never close a newer manual renewal',
);
assert.doesNotMatch(manager, /queueKeeperCheck\(profile\.id, 'capture-complete'\)/);
assert.match(sessions, /last_status: authenticated \? 'healthy' : 'registered'/);
assert.match(sessions, /last_check_at: now/);

assert.match(captureState, /export async function inspectCaptureSession/);
assert.match(captureState, /loginActionVisible/);
assert.match(captureState, /authenticated,/);
assert.match(captureState, /captureNavigationTarget/);
assert.match(captureState, /netflixAuthCookies/);
assert.match(captureState, /netflixAppPath/);
assert.match(manager, /Netflix no abrió el área autenticada \(\/browse\)/);

assert.match(
  clientEngine,
  /Number\(sessionMarker\?\.version \|\| 0\) === desiredSessionVersion/,
  'managed local profiles must adopt the exact central snapshot generation',
);
assert.match(
  clientEngine,
  /Number\(existing\.sessionVersion \|\| 0\) === desiredSessionVersion/,
  'already-open managed browsers must be replaced when the central generation changes',
);
assert.doesNotMatch(
  clientEngine,
  /Number\(sessionMarker\?\.version \|\| 0\) > 0[\s\S]{0,120}sessionMarker\?\.profileId === profile\.id/,
  'any-positive-version reuse must not allow stale managed sessions to outrank the server',
);

assert.match(clientMain, /preserveProfilesForAuthError/);
assert.match(clientMain, /clientId && !preserveProfiles/);
assert.match(clientMain, /session-fallback/);
assert.match(clientMain, /fallbackRecovered/);
assert.match(clientMain, /sessionVersion: Number\(result\?\.sessionVersion/);

assert.match(profilesView, /Keeper: activo/);
assert.match(profilesView, /Keeper: requiere acceso/);
assert.match(profilesView, /Keeper: pendiente/);

console.log('Session Keeper architecture: OK');
