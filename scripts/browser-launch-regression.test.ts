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
  engine,
  /capturedGenerationMatches[\s\S]{0,700}sessionMarker\?\.capturedAt[\s\S]{0,700}delivery\.capturedAt/,
  'managed snapshot reuse must compare capturedAt so a new v1 generation cannot be mistaken for an old v1 snapshot',
);

assert.doesNotMatch(
  engine,
  /localStateWithoutMarker\s*\|\|/,
  'portable managed profiles without a marker must replay the server snapshot instead of trusting unknown local cookies',
);

assert.match(
  sessionState,
  /flowTarget[\s\S]{0,400}isGoogleAccountsDomain\(cookie\?\.domain\)/,
  'Google Flow cookie repair must include Google Accounts host cookies as well as flow.google.com cookies',
);

assert.match(
  sessionState,
  /clearGoogleFlowCookies[\s\S]{0,1800}Network\.deleteCookies[\s\S]{0,6500}applyCookies\(browser, cookies\)/,
  'a new Google Flow snapshot must clear stale Google-account cookies before installing the captured generation',
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

assert.doesNotMatch(
  engine,
  /managedExtensionPathsHealth|extensionGuardTimer|recoverManagedExtensions|managed_extension_recovery/,
  'active profiles must never be force-killed from an inferred extension Preferences mismatch',
);

assert.match(
  engine,
  /async function managedExtensionSecuritySnapshot[\s\S]{0,3600}withholding_permissions[\s\S]{0,1800}runtime_granted_permissions/,
  'extension configuration protection must fingerprint security-sensitive host and runtime permission state',
);

assert.match(
  engine,
  /collectUserPermissionSiteSettings[\s\S]{0,1000}restricted_sites[\s\S]{0,500}permitted_sites/,
  'the global per-site extension toggle must be part of the tamper fingerprint',
);

assert.match(
  engine,
  /pinned_extensions[\s\S]{0,700}toolbar\?\.pinned_actions/,
  'pin/unpin changes for managed extensions must be treated as configuration changes',
);

assert.match(
  engine,
  /fs\.watch\(profileDir,[\s\S]{0,1000}Preferences[\s\S]{0,300}Secure Preferences/,
  'extension configuration protection must be event-driven from browser preference writes',
);

assert.match(
  engine,
  /extensionConfigTamperClosing = true[\s\S]{0,500}extension_configuration_tampered[\s\S]{0,300}killProcessTree\(entry\.process\)/,
  'any protected extension configuration change must close the managed browser immediately',
);

assert.doesNotMatch(
  engine,
  /setInterval\([^\n]{0,300}managedExtensionSecuritySnapshot|setInterval\([^\n]{0,300}extensionConfig/,
  'the configuration guard must not reintroduce periodic preference polling',
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
  engine,
  /USERFLEX_EXPECTED_MANAGED_EXTENSIONS = \$\{JSON\.stringify\(managedExtensionNames\)\}/,
  'Browser Guard must receive the exact managed extension names assigned to the active profile',
);

assert.match(
  guardBackground,
  /USERFLEX_EXPECTED_MANAGED_EXTENSIONS[\s\S]{0,1000}PROTECTED_NAMES/,
  'Browser Guard must protect only extensions expected for the current profile plus itself',
);

assert.match(
  guardBackground,
  /chrome\.management\.onDisabled[\s\S]{0,900}chrome\.management\.setEnabled\(item\.id, true\)[\s\S]{0,900}closeManagedProfile\(\)/,
  'disabling a protected extension must repair it and close the managed browser profile',
);

assert.match(
  guardBackground,
  /chrome\.management\.onUninstalled[\s\S]{0,500}protectedIds\.has\(id\)[\s\S]{0,500}closeManagedProfile\(\)/,
  'removing a protected extension must close the managed browser profile',
);

assert.match(
  guardBackground,
  /chrome\.permissions\?\.onAdded[\s\S]{0,500}closeManagedProfile\(\)[\s\S]{0,500}chrome\.permissions\?\.onRemoved/,
  'permission changes inside Browser Guard must close the managed profile',
);

assert.match(
  guardBackground,
  /chrome\.storage\?\.onChanged[\s\S]{0,300}closeManagedProfile\(\)/,
  'extension-local configuration storage changes must close the managed profile',
);

assert.match(
  guardBackground,
  /chrome\.windows\.getAll[\s\S]{0,700}chrome\.windows\.remove/,
  'extension tampering must close the browser windows rather than polling browser preference files',
);

assert.doesNotMatch(
  guardBackground,
  /setInterval\([^)]*managed|Preferences|Secure Preferences/,
  'Browser Guard tamper enforcement must be event-driven and must not revive the old destructive preference watchdog',
);

assert.match(
  engine,
  /--disable-features=SignInProfileCreation,SigninConsistency,ExtensionsMenuAccessControl,ExtensionsToolbarZeroState,ExtensionsToolbarMenu/,
  'extension UI hardening must remain enabled without a destructive browser watchdog',
);

assert.match(
  engine,
  /async function suppressEdgeDeveloperModeExtensionWarning/,
  'userFLOW must define isolated Edge developer-extension warning suppression',
);
assert.match(
  engine,
  /const snoozeEnd = '99999999999000000'/,
  'userFLOW must use a far-future Edge warning snooze timestamp',
);
assert.match(
  engine,
  /preferences\.extensions\.ui\.dev_mode_warning_snooze_end_time = snoozeEnd/,
  'userFLOW must persist Edge\'s developer-extension warning snooze inside its managed profile',
);

assert.match(
  engine,
  /if \(hasManagedExtensions && browserKind\(executable\) === 'edge'\) \{\s*await suppressEdgeDeveloperModeExtensionWarning\(userDataDir\)/,
  'managed Edge profiles must suppress the destructive developer-mode extension warning before launch',
);

console.log('Managed browser launch/autofill regression checks: OK');
