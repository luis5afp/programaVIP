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


assert.match(
  engine,
  /resolveManagedExtensionBrowserExecutable[\s\S]{0,1200}chrome_native[\s\S]{0,400}edgeCandidates\(\)[\s\S]{0,400}nativeChromeCandidates/,
  'managed extensions must prefer bundled Chromium/Edge before branded Chrome',
);

assert.match(
  engine,
  /hasManagedExtensions[\s\S]{0,350}resolveManagedExtensionBrowserExecutable/,
  'profiles with managed extensions must use the extension-capable browser resolver',
);

assert.match(
  engine,
  /MANAGED_EXTENSION_BROWSER_UNSUPPORTED/,
  'branded Chrome fallback must fail explicitly instead of reporting a false zero-extension test',
);

assert.match(
  engine,
  /entry\.browserKind === 'edge' \? 'edge:\/\/extensions\/' : 'chrome:\/\/extensions\/'/,
  'extension inspection must use the correct internal extension page for Edge and Chromium',
);

assert.match(
  engine,
  /browser-preferences/,
  'extension validation must also inspect persistent browser extension state',
);

assert.match(
  engine,
  /browser\.targets\(\)/,
  'extension validation must fall back to extension targets when the internal WebUI changes',
);

console.log('Managed browser launch/autofill regression checks: OK');
