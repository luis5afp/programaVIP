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
  /clearStaleBrowserProcessArtifacts[\s\S]{0,700}SingletonLock[\s\S]{0,300}SingletonCookie[\s\S]{0,300}SingletonSocket[\s\S]{0,300}DevToolsActivePort/,
  'managed launch must remove stale Chromium process-control artifacts without clearing persistent session state',
);

assert.match(
  engine,
  /await killStrayProfileProcesses\(userDataDir\)[\s\S]{0,180}await clearStaleBrowserProcessArtifacts\(userDataDir\)/,
  'stale process locks must be removed only after profile-owned browser processes are stopped',
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
  engine,
  /optionalSnapshotCredentials = runtime\.authStrategy === 'cookie-snapshot'[\s\S]{0,260}credentials\?\.required === false[\s\S]{0,220}credentialHelperEnabled = credentialsAvailable/,
  'cookie-snapshot profiles must use delivered managed credentials as a login fallback instead of discarding them client-side',
);

assert.match(
  sessionState,
  /__userflexCredentialAutofillV4102/,
  'credential helper version must advance when the KAIZEN-style integration changes',
);
assert.match(
  sessionState,
  /collectSearchRoots[\s\S]{0,1500}shadowRoot[\s\S]{0,900}contentDocument/,
  'credential helper must discover login controls in open Shadow DOM and same-origin iframe documents',
);
assert.match(
  sessionState,
  /ownerDocument\?\.defaultView[\s\S]{0,700}HTMLInputElement\?\.prototype[\s\S]{0,1100}composed: true/,
  'credential helper must use the target field realm native setter/events for React/Vue/iframe compatibility',
);
assert.match(
  sessionState,
  /<span class="uf-brand">userFLOW<\/span>[\s\S]{0,250}data-kind="username">Email[\s\S]{0,250}data-kind="password">Password/,
  'credential helper must expose the compact KAIZEN-style Email/Password control bar',
);
assert.match(
  sessionState,
  /observeCurrentRoots[\s\S]{0,1500}setInterval\([\s\S]{0,350}2500/,
  'credential helper must survive bounded SPA/modal transitions without high-frequency polling',
);

assert.doesNotMatch(
  engine,
  /--user-agent=/,
  'managed launches must use the native browser User-Agent so HTTP UA, Client Hints, TLS and engine identity stay consistent',
);

assert.match(
  sessionState,
  /humanVerificationVisible[\s\S]{0,700}cloudflare-turnstile[\s\S]{0,260}google-recaptcha[\s\S]{0,260}hcaptcha/,
  'runtime inspection must report human-verification surfaces without attempting to bypass them',
);
assert.match(
  main,
  /inspection\?\.humanVerificationVisible === true[\s\S]{0,180}outcome = 'human-verification-required'/,
  'client-test must report a human verification as a manual-required state instead of an autofill/session failure',
);
assert.match(
  main,
  /clientVersion: app\.getVersion\(\)[\s\S]{0,500}launchDiagnostics/,
  'client-test failures must report the exact userFLOW version and browser startup diagnostics',
);
assert.match(
  engine,
  /error\.launchDiagnostics = \{[\s\S]{0,550}browser:[\s\S]{0,260}exitCode:[\s\S]{0,260}processAlive:[\s\S]{0,260}stderr:/,
  'fatal launch errors must carry browser/exit/stderr diagnostics to the Admin test',
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
assert.match(
  engine,
  /function managedSnapshotNavigationUrl[\s\S]{0,700}member\.toolspoint\.net[\s\S]{0,500}target\.pathname = '\/profile'/,
  'ToolsPoint snapshots must normalize public/login URLs to the authenticated /profile surface',
);
assert.match(
  engine,
  /snapshotNavigationUrl = snapshotManaged[\s\S]{0,180}managedSnapshotNavigationUrl\(profile\.url\)/,
  'managed snapshots must compute an authenticated navigation target before launch',
);
assert.match(
  engine,
  /ensureManagedSnapshotCookies\([\s\S]{0,220}profileUrl: snapshotNavigationUrl[\s\S]{0,500}navigateBrowserHome\([^\n]*snapshotNavigationUrl/,
  'snapshot reuse must repair cookies and navigate on the authenticated snapshot target',
);
assert.match(
  engine,
  /restorePortableSession\([\s\S]{0,220}profileUrl: snapshotNavigationUrl/,
  'fresh snapshot restore must load the authenticated snapshot target',
);
assert.match(
  engine,
  /fallbackNavigation = snapshotManaged \? 'snapshot-authenticated-home'/,
  'degraded snapshot fallback must not send ToolsPoint back to its public login URL',
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
  /async function clearGoogleFlowCookies[\s\S]{0,2200}Network\.deleteCookies/,
  'Google Flow restore must define targeted cleanup for stale Google-account cookies',
);

assert.match(
  sessionState,
  /googleCookiesAuthoritative:\s*isGoogleFlowTarget\(target\)/,
  'Flow restore must persist a marker proving that stale Google cookies were authoritatively replaced',
);

assert.match(
  engine,
  /googleFlowAuthoritativeReplayReady[\s\S]{0,450}googleCookiesAuthoritative === true[\s\S]{0,900}sessionVersionMatches/,
  'legacy Flow markers must force one authoritative server-snapshot replay even when version and capturedAt already match',
);


const flowCleanupPosition = sessionState.indexOf('await clearGoogleFlowCookies(browser, target)');
const flowApplyPosition = sessionState.indexOf('const cookieResult = await applyCookies(browser, cookies);', flowCleanupPosition);
assert.ok(
  flowCleanupPosition >= 0 && flowApplyPosition > flowCleanupPosition,
  'a new Google Flow snapshot must clear stale Google-account cookies before installing the captured generation',
);


assert.match(
  sessionState,
  /navigateBrowserHome\(debugPort, profileUrl, \{ closeExtraPages = false \} = \{\}\)/,
  'home navigation must support single-tab normalization on fresh launches',
);

assert.match(
  sessionState,
  /new InputEventCtor\('input'[\s\S]{0,220}composed: true/,
  'autofill must emit a native input event in the target field realm for controlled login fields',
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
  /optionalSnapshotCredentials = runtime\.authStrategy === 'cookie-snapshot'[\s\S]{0,260}credentials\?\.required === false[\s\S]{0,220}credentialHelperEnabled = credentialsAvailable/,
  'optional stored credentials must remain available as a cookie-snapshot login fallback',
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
  /recoverableLaunchStages = new Set\(\[[\s\S]{0,220}'browser-control'[\s\S]{0,300}'session-restore'[\s\S]{0,300}'navigation'[\s\S]{0,300}'credential-autofill'/,
  'browser control and page/session bootstrap failures must be explicitly recoverable once the browser process is running',
);
assert.match(
  engine,
  /connectKaizenBrowser\(debugPort, 60_000\)/,
  'initial managed-browser control handshake must allow slow persistent profiles up to sixty seconds',
);
assert.match(
  sessionState,
  /export async function connectKaizenBrowser\(debugPort, timeoutMs = 25_000\)[\s\S]{0,180}waitForDevtools\(debugPort, timeoutMs\)/,
  'browser connection helper must accept an explicit startup timeout',
);
assert.match(
  engine,
  /startupUrl = snapshotManaged[\s\S]{0,260}sessionVersionMatches \|\| hasPersistentBrowserState\(userDataDir\)[\s\S]{0,260}snapshotNavigationUrl/,
  'snapshot profiles with persistent local state must start on their managed authenticated URL before CDP is required',
);
assert.match(
  engine,
  /launchStage === 'browser-control'[\s\S]{0,900}browser-startup-url/,
  'a running browser with unavailable CDP control must remain open in degraded mode instead of being killed',
);

const recoverableCatchStart = engine.indexOf('if (browserStillRunning && recoverableLaunchStages.has(launchStage))');
const recoverableCatchEnd = engine.indexOf("profileState: 'launch-degraded'", recoverableCatchStart);
assert.ok(
  recoverableCatchStart >= 0 && recoverableCatchEnd > recoverableCatchStart,
  'recoverable bootstrap failures must keep the browser process alive and return degraded diagnostics',
);

assert.match(
  engine,
  /launchStage === 'session-restore'[\s\S]{0,1200}snapshotManaged \? snapshotNavigationUrl : profile\.url[\s\S]{0,300}closeExtraPages: true/,
  'failed session restore must make a best-effort navigation to the authenticated snapshot target without killing the browser',
);

const fatalKill = engine.indexOf('await killProcessTree(proc);', recoverableCatchEnd);
const fatalCleanup = engine.indexOf('launch_failed:${launchStage}', fatalKill);
assert.ok(
  fatalKill > recoverableCatchEnd && fatalCleanup > fatalKill,
  'non-recoverable launch failures must still fail closed and terminate the managed browser',
);

assert.doesNotMatch(
  engine,
  /managedExtensionSecuritySnapshot|armManagedExtensionConfigurationGuard|extensionConfigWatcher|extensionConfigTamperClosing/,
  'normal Chromium/Edge Preferences writes must never be treated as proof of extension tampering',
);

assert.match(
  engine,
  /resolveManagedExtensionBrowserExecutable[\s\S]{0,1400}\.\.\.edgeCandidates\(\)[\s\S]{0,300}chrome_native[\s\S]{0,400}nativeChromeCandidates/,
  'managed extensions must prefer installed Edge before stale bundled Chromium or branded Chrome',
);

assert.match(
  engine,
  /managedExtensionKey:\s*desiredManagedExtensionKey/,
  'running profiles must store a catalog-comparable managed extension fingerprint separately from the full launch fingerprint',
);

assert.match(
  engine,
  /extensionsChanged = runningEntry[\s\S]{0,260}runningEntry\.managedExtensionKey[\s\S]{0,220}desiredManagedExtensionKey/,
  'catalog reconciliation must compare managed extension assignments without Browser Guard or streaming DOM launch metadata',
);

assert.doesNotMatch(
  engine,
  /extensionsChanged = runningEntry[^\n]*runningEntry\.extensionKey/,
  'revisiting the catalog must not compare the full launch fingerprint against catalog-only extension metadata',
);

assert.match(
  engine,
  /const desiredCredentialRevision = wantsCredentials \? String\(profile\.credentialVersion \|\| ''\) : ''/,
  'catalog reconciliation must track credential revisions only for auth strategies that actually use managed credentials',
);

assert.doesNotMatch(
  engine,
  /optionalCredentialHelper|tracksCredentialRevision/,
  'cookie-snapshot profiles must not be closed because optional unused credentials have a revision',
);

assert.match(
  main,
  /const shouldReconcile = reason !== 'catalog' \|\| configChanged/,
  'normal catalog navigation must be non-destructive when the server configuration revision has not changed',
);

assert.match(
  main,
  /if \(clientId && shouldReconcile\)[\s\S]{0,220}reconcileCatalogProfiles/,
  'live process reconciliation must be gated behind the catalog/config-change decision',
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

assert.doesNotMatch(
  engine,
  /fs\.watch\([^\n]*Preferences|Secure Preferences[\s\S]{0,600}killProcessTree/,
  'browser preference-file churn must never force-close an active profile',
);

assert.match(
  guardBackground,
  /chrome\.management\.onDisabled[\s\S]{0,900}closeManagedProfile\(\)[\s\S]{0,900}chrome\.management\.onUninstalled/,
  'Browser Guard must keep direct event-driven disable/uninstall tamper enforcement',
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

assert.doesNotMatch(
  guardBackground,
  /chrome\.permissions\?\.onAdded[\s\S]{0,500}closeManagedProfile\(\)|chrome\.permissions\?\.onRemoved[\s\S]{0,500}closeManagedProfile\(\)/,
  'Browser Guard must not close a visible profile for its own permission bookkeeping events',
);

assert.doesNotMatch(
  guardBackground,
  /chrome\.storage\?\.onChanged[\s\S]{0,300}closeManagedProfile\(\)/,
  'Browser Guard must not close a visible profile for benign extension-local storage churn',
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
