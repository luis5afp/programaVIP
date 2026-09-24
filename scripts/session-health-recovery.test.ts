import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const state = readFileSync(new URL('../client-app/browser-engine/session-state.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../session-manager/browser-engine/capture-state.js', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const profilesView = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(
  sessions,
  /last_captured_at: now,\s*last_validated_at: options\.validatedAt \|\| null,/,
  'central session storage must only mark validation when explicitly supplied',
);
assert.match(
  sessions,
  /\/api\/session-manager\/complete[\s\S]{0,1800}authenticated = body\.authenticated === true[\s\S]{0,900}validatedAt: authenticated \? now : null/,
  'capture must be marked verified only when Session Manager explicitly confirms a real authenticated browser state',
);
assert.match(
  sessions,
  /sessionChecked && sessionOutcome === 'snapshot-authenticated'/,
  'manual runtime validation must only advance verification on confirmed authentication',
);
assert.match(
  state,
  /loginActionVisible/,
  'runtime inspection must detect visible login/sign-in actions',
);
assert.match(
  main,
  /inspectionNeedsLogin\(inspection\)/,
  'client launch must evaluate whether the managed session is still authenticated',
);
assert.match(
  main,
  /result\?\.profileState === 'persistent-reuse'[\s\S]{0,900}forceRestore: true/,
  'a stale persisted profile must retry once from the server snapshot',
);
assert.match(
  main,
  /\/api\/client\/profiles\/\$\{profileId\}\/session-health/,
  'client must report live session health to the server',
);
assert.match(
  engine,
  /forceRestore = false/,
  'browser engine must support a one-time forced snapshot restore',
);
assert.match(
  engine,
  /const sessionVersionMatches = !forceRestore/,
  'forced restore must bypass the local generation reuse check',
);
assert.match(
  engine,
  /const sessionVersionMatches = !forceRestore[\s\S]{0,260}Number\(sessionMarker\?\.version \|\| 0\) === desiredSessionVersion/,
  'a local managed profile must only reuse the exact central snapshot generation',
);
assert.match(
  engine,
  /const generationMatches = \(!snapshotManaged[\s\S]{0,180}Number\(existing\.sessionVersion \|\| 0\) === desiredSessionVersion/,
  'an already-open managed browser must also be replaced when the central snapshot generation changes',
);
assert.match(
  state,
  /flowSignedOut/,
  'runtime inspection must explicitly recognize signed-out Google Flow state',
);
assert.match(
  state,
  /servicelogin/,
  'runtime inspection must recognize Google ServiceLogin redirects',
);
assert.match(
  capture,
  /cookieRelevantToTarget/,
  'Flow capture must include Google Accounts host cookies in addition to flow.google.com cookies',
);
assert.match(
  capture,
  /Google Flow todavía no expuso cookies de autenticación activas/,
  'Flow capture must reject snapshots without active Google authentication cookies',
);
assert.match(
  worker,
  /\/session-health\$\/i/,
  'Worker must expose the session-health route',
);
assert.match(
  client,
  /confirmedFailure[\s\S]{0,1200}status: 'needs_auth'/,
  'client health must revoke only an explicitly confirmed real access failure',
);
assert.doesNotMatch(
  client,
  /last_validated_at: now/,
  'normal client launches must not keep extending a validation timer',
);
assert.match(
  main,
  /confirmedFailure: accessFailed[\s\S]{0,420}confirmed-client-access-failure/,
  'userFLOW must confirm a repeated access failure before requesting revocation',
);
assert.match(
  profilesView,
  /no caduca por tiempo/,
  'Admin must show that a completed initial validation does not expire by age',
);
assert.match(
  profilesView,
  /validar una vez/,
  'Admin must distinguish an unvalidated initial snapshot from a validated one',
);

console.log('Managed session health recovery: OK');
