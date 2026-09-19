import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const sessionState = readFileSync(new URL('../client-app/browser-engine/session-state.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  engine,
  /--restore-last-session(?:=false)?/,
  'managed Chrome must never request restoring the previous tab session',
);

assert.match(
  engine,
  /clearStartupSessionArtifacts\(userDataDir\)/,
  'managed launch must delete Chrome tab/session restore artifacts before startup',
);

assert.match(
  engine,
  /navigateBrowserHome\(debugPort, profile\.url, \{ closeExtraPages: true \}\)/,
  'a fresh managed launch must normalize to one visible profile tab',
);

const launchStart = engine.indexOf('async function launch({');
const launchEnd = engine.indexOf('async function inspect(', launchStart);
assert.ok(launchStart >= 0 && launchEnd > launchStart, 'KAIZEN launch function must be discoverable');
const launch = engine.slice(launchStart, launchEnd);
const restorePosition = launch.lastIndexOf('restorePortableSession({');
const autofillPosition = launch.lastIndexOf('installCredentialAutofill({');
assert.ok(restorePosition >= 0, 'managed snapshot restore must remain enabled');
assert.ok(
  autofillPosition > restorePosition,
  'credential autofill must be installed after the definitive managed page is restored/navigated',
);

assert.match(
  sessionState,
  /const finalPages = await browser\.pages\(\);[\s\S]{0,600}await extra\.close\(\)/,
  'snapshot restoration must close stale startup tabs',
);

assert.match(
  sessionState,
  /navigateBrowserHome\(debugPort, profileUrl, \{ closeExtraPages = false \} = \{\}\)/,
  'home navigation must support single-tab normalization on fresh launches',
);

assert.match(
  sessionState,
  /new InputEvent\('input'/,
  'autofill must emit a native input event for controlled login fields',
);

console.log('Managed browser launch/autofill regression checks: OK');
