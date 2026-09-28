import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const sessionState = readFileSync(new URL('../client-app/browser-engine/session-state.js', import.meta.url), 'utf8');
const guardManifest = readFileSync(new URL('../client-app/browser-engine/extension/manifest.json', import.meta.url), 'utf8');
const guardBackground = readFileSync(new URL('../client-app/browser-engine/extension/background.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');

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
  sessionState,
  /LOGIN_INPUT_SELECTOR/,
  'credential helper must scan only likely login inputs instead of every input in heavy editors',
);

assert.doesNotMatch(
  sessionState,
  /observer\.observe\([\s\S]{0,260}attributes:\s*true/,
  'credential helper must not watch style/class attribute churn on heavy SPA pages',
);

assert.match(
  sessionState,
  /setInterval\(\(\) => scheduleFill\(0\), 15000\)/,
  'credential helper fallback polling must stay low-frequency',
);

assert.match(
  sessionState,
  /setTimeout\(stopBackgroundScanning, 120000\)/,
  'credential helper background scanning must stop after the login window',
);

assert.match(
  sessionState,
  /requestIdleCallback\(run, \{ timeout: 700 \}\)/,
  'credential scans should run during browser idle time when available',
);

assert.match(
  engine,
  /'digen\.ai'/,
  'Digen must be excluded from STREAMING DOM automation even if misclassified',
);

assert.match(
  engine,
  /const credentialHelperEnabled = credentialManaged && credentialsAvailable/,
  'optional stored credentials must not inject the helper into cookie-snapshot profiles',
);

assert.match(
  sessionState,
  /performanceSensitive: \['digen\.ai'\]/,
  'Digen must use performance-sensitive credential-helper mode',
);

assert.match(
  sessionState,
  /if \(performanceSensitive && !forced\)[\s\S]{0,900}activateOnLoginFocus[\s\S]{0,700}start\(true\)/,
  'authenticated Digen pages must keep the credential observer dormant until a real login field receives focus',
);

assert.match(
  engine,
  /setInterval\(\(\) => void closeDevtoolsTargets\(debugPort\), 5000\)/,
  'DevTools guard must not poll Chrome several times per second',
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
  /if \(hasManagedExtensions\) \{[\s\S]{0,160}setTimeout\(resolve, 1600\)/,
  'managed extensions must finish Edge startup registration before the first visible navigation',
);

assert.match(
  engine,
  /MANAGED_EXTENSION_BROWSER_UNSUPPORTED/,
  'branded Chrome fallback must fail explicitly instead of reporting a false zero-extension test',
);

assert.match(
  engine,
  /const internalUrl = entry\.browserKind === 'edge' \? null : 'chrome:\/\/extensions\/'/,
  'Edge validation must skip unstable edge://extensions navigation entirely',
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

assert.match(
  engine,
  /if \(internalUrl\)[\s\S]{0,300}page\.goto\(internalUrl/,
  'internal extension WebUI inspection must be optional and Chromium-only',
);

assert.match(
  engine,
  /internalNavigationError,[\s\S]{0,120}stderr:/,
  'extension inspection should return internal WebUI navigation diagnostics without treating them as fatal',
);

assert.match(
  engine,
  /ExtensionsMenuAccessControl,ExtensionsToolbarZeroState,ExtensionsToolbarMenu/,
  'managed browser launches must suppress Edge extension toolbar management features when supported',
);

assert.match(
  engine,
  /async function managedExtensionPathsHealth[\s\S]{0,1800}Preferences[\s\S]{0,800}Secure Preferences/,
  'userFLOW must verify protected extension state from the persistent browser profile',
);

assert.match(
  engine,
  /extensionGuardTimer = setInterval\(\(\) => void enforceManagedExtensionHealth\(entry\), 3000\)/,
  'managed extensions must be checked continuously without high-frequency polling',
);

assert.match(
  engine,
  /recoverManagedExtensions[\s\S]{0,1500}managed_extension_recovery[\s\S]{0,900}await launch\(\{ \.\.\.relaunch, forceRestore: false \}\)/,
  'removing or disabling a managed extension must trigger an automatic browser recovery',
);

assert.match(
  sessionState,
  /edge:\/\/extensions[\s\S]{0,180}edge:\/\/settings[\s\S]{0,500}json\/close/,
  'extension/settings WebUI targets must be closed from outside the browser extension sandbox',
);

assert.match(
  guardManifest,
  /"management"/,
  'Browser Guard needs management permission to re-enable protected extensions',
);

assert.match(
  guardBackground,
  /PROTECTED_NAMES[\s\S]{0,1500}chrome\.management\.onDisabled[\s\S]{0,800}setEnabled\(item\.id, true\)/,
  'Browser Guard must immediately re-enable protected extensions when possible',
);

assert.match(
  main,
  /reason === 'managed_extension_recovery'/,
  'automatic extension recovery must not close the active profile usage record',
);

console.log('Managed browser launch/autofill regression checks: OK');
