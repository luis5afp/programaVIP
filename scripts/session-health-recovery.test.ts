import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const state = readFileSync(new URL('../client-app/browser-engine/session-state.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../client-app/browser-engine/extension/content.js', import.meta.url), 'utf8');
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
  state,
  /Netflix can rotate NetflixId\/SecureNetflixId immediately/,
  'Netflix cookie rotation must be treated as a normal authenticated response, not a restore failure',
);
assert.doesNotMatch(
  state,
  /Chrome no pudo conservar exactamente las cookies de autenticación de Netflix/,
  'userFLOW must not close Netflix merely because Netflix rotated authentication cookie values',
);
assert.match(
  state,
  /cookieVerification/,
  'portable session restore must return cookie diagnostics without aborting the browser launch',
);
assert.match(
  main,
  /inspectionNeedsLogin\(inspection\)/,
  'client launch must evaluate whether the managed session is still authenticated',
);
assert.match(
  main,
  /inspection\?\.netflixHouseholdRestriction === true \|\| inspection\?\.streamingAccessRestriction === true\) return false/,
  'STREAMING device/household restrictions must not be reported as expired authentication sessions',
);
assert.match(
  state,
  /netflixHouseholdRestriction/,
  'runtime inspection must identify the official Netflix Household restriction separately',
);
assert.match(
  state,
  /streamingAccessRestriction/,
  'runtime inspection must identify device restrictions for STREAMING profiles separately from login failure',
);
assert.match(
  engine,
  /globalThis\.USERFLEX_STREAMING_DOM/,
  'STREAMING DOM capability must be passed to the per-profile browser extension',
);
assert.match(
  engine,
  /blockedStreamingDomHosts[\s\S]{0,900}thirdPartyStreamingProvider/,
  'known third-party streaming providers must stay outside project DOM automation',
);
assert.match(
  engine,
  /function browserGuardRevision[\s\S]{0,900}guardRevision[\s\S]{0,500}streaming-dom:/,
  'built-in STREAMING script revisions must participate in browser generation matching',
);
assert.match(
  guard,
  /USERFLEX_STREAMING_DOM !== true/,
  'STREAMING DOM script must activate from the per-profile extension flag',
);
assert.match(
  guard,
  /MutationObserver/,
  'STREAMING DOM script must keep watching dynamic page changes',
);
assert.match(
  guard,
  /setInterval\(process, 750\)/,
  'STREAMING DOM script must re-enforce hiding when project pages rebuild their UI',
);
assert.match(
  guard,
  /TEXT_PATTERN[\s\S]{0,1000}ver\\s\+temporalmente/,
  'STREAMING DOM script must detect the simulated device/household message in project pages',
);
assert.match(
  guard,
  /style\.setProperty\('display', 'none', 'important'\)/,
  'STREAMING DOM script must force-hide matched project overlays',
);
assert.match(
  state,
  /dataset\.userflexStreamingDom === 'active'/,
  'runtime inspection must read STREAMING DOM diagnostics from the browser extension',
);
assert.match(
  main,
  /profile\?\.runtime\?\.deviceLocalAuth === true\) return false/,
  'STREAMING device-local auth must bypass managed snapshot recovery in userFLOW',
);
assert.match(
  main,
  /profile\?\.runtime\?\.deviceLocalAuth === true[\s\S]{0,500}streamingAccessRestriction/,
  'device-local STREAMING sessions must be inspected read-only for provider restrictions',
);
assert.match(
  main,
  /Detection is[\s\S]{0,180}must never hide, click through, or bypass provider UI/,
  'provider household/device UI must never be bypassed by userFLOW',
);
assert.match(
  engine,
  /if \(runtime\.deviceLocalAuth === true\) return false/,
  'browser engine must never restore a central snapshot for device-local STREAMING auth',
);
assert.match(
  state,
  /clearTransferredNetflixAuthCookies/,
  'legacy Netflix profiles must have a one-time migration path that removes only transferred authentication cookies',
);
assert.match(
  state,
  /\['netflixid', 'securenetflixid'\]/,
  'Netflix migration must preserve device-local state and clear only transferred auth cookies',
);
assert.match(
  engine,
  /deviceLocalAuthMigrationNeeded/,
  'existing Netflix profiles must detect whether the one-time device-local migration is needed',
);
assert.match(
  engine,
  /clearTransferredNetflixAuthCookies\(\{/,
  'existing Netflix profiles must run the one-time auth-cookie migration without deleting browser identity',
);
assert.match(
  engine,
  /streamingProfile:[\s\S]{0,180}storageStrategy === 'netflix-local-device'/,
  'the browser inspector must receive STREAMING policy from the effective runtime',
);
assert.match(
  engine,
  /preserveDeviceLocalState[\s\S]{0,700}sessionMarker = null/,
  'STREAMING device-local authorization must survive central snapshot generation changes',
);
assert.match(
  engine,
  /restorePolicyMatches[\s\S]{0,180}preserveDeviceLocalState/,
  'old STREAMING markers must migrate without forcing a destructive restore',
);
assert.match(
  engine,
  /if \(runtimeChanged \|\| snapshotChanged\) \{[\s\S]{0,120}invalidateSessionMarker\(dir\)/,
  'catalog refresh may invalidate only the userFLEX marker and must preserve browser storage for every category',
);
assert.doesNotMatch(
  engine,
  /if \(runtimeChanged \|\| snapshotChanged\) \{[\s\S]{0,180}fsp\.rm\(dir/,
  'runtime, snapshot, admin, or application changes must never erase a local browser profile automatically',
);
assert.doesNotMatch(
  engine,
  /resetProfileDirectory/,
  'automatic profile resets are forbidden by the persistence invariant',
);
assert.match(
  engine,
  /Mandatory persistence invariant:[\s\S]{0,220}must never erase the browser profile/,
  'browser persistence must be documented and enforced as a mandatory invariant',
);
assert.match(
  engine,
  /function hasPersistentBrowserState\(userDataDir\)/,
  'the browser engine must detect persistent local browser state independently of the userFLEX marker',
);
assert.match(
  engine,
  /const localStateWithoutMarker = snapshotManaged && !sessionMarker && localBrowserStatePresent/,
  'a missing marker after an update must not cause a good local browser profile to be overwritten',
);
assert.match(
  engine,
  /localStateWithoutMarker[\s\S]{0,420}sessionVersionMatches/,
  'existing local browser state must be tried before replaying the central snapshot',
);
assert.match(
  engine,
  /Catalog\/admin changes may revoke access[\s\S]{0,360}await close\(clientId, item\.name, 'profile_revoked'\)/,
  'catalog/admin changes may close unauthorized browsers but must preserve their local profile data',
);
assert.doesNotMatch(
  engine,
  /reconcileAuthorizedProfiles[\s\S]{0,900}removeLocalProfile\(/,
  'catalog reconciliation must never destructively delete local browser profiles',
);
assert.match(
  engine,
  /!preserveDeviceLocalState && markerPolicy !== desiredPolicy/,
  'legacy portable markers must be accepted when a saved profile becomes STREAMING',
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
  /const sessionVersionMatches = !forceRestore[\s\S]{0,320}preserveDeviceLocalState[\s\S]{0,180}Number\(sessionMarker\?\.version \|\| 0\) === desiredSessionVersion/,
  'STREAMING local state may outlive a central snapshot generation while other managed profiles still require an exact version match',
);
assert.match(
  engine,
  /const generationMatches = \(!snapshotManaged[\s\S]{0,180}preserveDeviceLocalState[\s\S]{0,180}Number\(existing\.sessionVersion \|\| 0\) === desiredSessionVersion/,
  'an already-open STREAMING browser must remain open across central snapshot changes until a real access failure occurs',
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
