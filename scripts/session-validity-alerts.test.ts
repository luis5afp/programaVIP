import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy = readFileSync(new URL('../cloudflare/lib/session-health-policy.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');

assert.match(policy, /session\.status === 'needs_auth'/);
assert.match(policy, /status: 'needs_renewal'/);
assert.match(policy, /status: 'pending_validation'/);
assert.match(policy, /Validation is intentionally one-time/);
assert.doesNotMatch(policy, /SESSION_VALIDATION_WARN_MS/);
assert.doesNotMatch(policy, /SESSION_VALIDATION_STALE_MS/);
assert.doesNotMatch(policy, /status: 'stale_validation'/);
assert.doesNotMatch(policy, /status: 'renew_soon'/);

assert.match(
  client,
  /userflex_profile_sessions\?select=profile_id,session_version,status,expected_egress_ip,last_validated_at/,
  'catalog must include live validation timestamp',
);
assert.match(
  client,
  /const launchReady = sessionReady && networkReady/,
  'catalog must keep unavailable profiles visible but not launchable',
);
assert.match(
  client,
  /managedSessionHealth\([\s\S]{0,450}MANAGED_SESSION_VALIDATION_REQUIRED/,
  'server launch must enforce the managed-session validity policy',
);
assert.match(client, /sessionStatus: snapshotRequired \? snapshotHealth\.status : 'valid'/);

assert.match(sessions, /path === '\/api\/profile-session-alerts'/);
assert.match(sessions, /criticalCount:/);
assert.match(sessions, /warningCount:/);
assert.match(
  sessions,
  /last_status: 'needs_admin'/,
  'Keeper can block a session after confirmed login loss',
);
assert.doesNotMatch(
  sessions,
  /last_status: 'needs_admin'[\s\S]{0,900}last_validated_at: null/,
  'Keeper must preserve the last-known-good validation timestamp',
);
assert.match(
  client,
  /confirmedFailure[\s\S]{0,1500}touchProfileClients\(env, profileId\)/,
  'clients should be notified when a real access failure revokes a session',
);

assert.match(renderer, /Requiere renovación/);
assert.match(renderer, /Sesión pendiente/);
assert.match(renderer, /Esperando admin/);
assert.match(app, /api\.profileSessions\.alerts\(\)/);
assert.match(app, /5 \* 60 \* 1000/);
assert.match(layout, /session-alert-banner/);
assert.match(layout, /Revisar perfiles/);

console.log('Session validity + Admin alerts: OK');
