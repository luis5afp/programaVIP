import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const captureState = readFileSync(
  new URL('../session-manager/browser-engine/capture-state.js', import.meta.url),
  'utf8',
);
const engine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);
const clientEngine = readFileSync(
  new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url),
  'utf8',
);

assert.match(captureState, /export async function installCaptureAutomation/, 'capture must provide a CDP autofill fallback');
assert.match(captureState, /evaluateOnNewDocument\(bootstrap, payload\)/, 'autofill must survive same-tab navigations');
assert.match(captureState, /browser\.on\('targetcreated', onTarget\)/, 'autofill must attach to newly opened Google tabs');
assert.match(captureState, /browser\.on\('targetchanged', onTarget\)/, 'autofill must re-check navigated targets');
assert.match(captureState, /page\.exposeFunction\(payload\.saveBinding/, 'save action must have a CDP bridge independent of extension messaging');
assert.match(captureState, /identifier\|identifierid/, 'Google identifier fields must be recognized');
assert.match(captureState, /password\|passwd\|passcode/, 'Google password fields must be recognized');
assert.match(captureState, /userflex-session-overlay/, 'capture helper must provide a visible fallback overlay');
assert.match(engine, /installCaptureAutomation\([\s\S]{0,500}navigateCaptureHome/, 'CDP helper must be installed before navigating the managed tab');
assert.match(
  engine,
  /isTurnstileSensitiveProfileUrl[\s\S]{0,350}toolspoint\.net/,
  'ToolsPoint must use the security-challenge-safe capture path',
);
assert.match(
  engine,
  /function challengeSafeChromeArgs\([\s\S]{0,450}--no-first-run[\s\S]{0,500}return args/,
  'Turnstile human phase must use a minimal native browser launch',
);
assert.doesNotMatch(
  engine.match(/function challengeSafeChromeArgs\([\s\S]*?\n\}/)?.[0] || '',
  /remote-debugging-port|load-extension|disable-extensions-except/,
  'Turnstile human phase must not expose remote debugging or load the capture extension',
);
const nativeAutofillStart = engine.indexOf('async function nativeCredentialAutofill');
const nativeAutofillEnd = engine.indexOf('\nasync function killStrayProfileProcesses', nativeAutofillStart);
assert.ok(
  nativeAutofillStart >= 0 && nativeAutofillEnd > nativeAutofillStart,
  'native credential autofill helper must be present',
);
const nativeAutofillSource = engine.slice(nativeAutofillStart, nativeAutofillEnd);
assert.match(nativeAutofillSource, /UIAutomationClient/);
assert.match(nativeAutofillSource, /ValuePattern/);
assert.match(nativeAutofillSource, /USERFLEX_AUTOFILL_PASSWORD/);
assert.match(
  engine,
  /runPowerShellWithEnv\(script,[\s\S]{0,220}USERFLEX_AUTOFILL_USERNAME[\s\S]{0,220}USERFLEX_AUTOFILL_PASSWORD/,
  'managed credentials must be passed to the native helper via environment variables rather than command-line interpolation',
);
assert.match(
  engine,
  /challengeSafeCapture && \(credentials\?\.username \|\| credentials\?\.password\)[\s\S]{0,650}nativeCredentialAutofill/,
  'challenge-safe ToolsPoint capture must schedule native credential fill when managed credentials are available',
);
assert.match(
  engine,
  /challengeSafeCapture[\s\S]{0,900}preferSystemBrowser: challengeSafeCapture/,
  'challenge-safe captures must prefer an installed system Chrome or Edge over bundled Chromium',
);
assert.match(
  engine,
  /if \(challengeSafeCapture\)[\s\S]{0,600}no Puppeteer\/CDP attachment until the administrator explicitly saves/,
  'Turnstile capture must remain detached from Puppeteer/CDP until explicit save',
);
assert.match(
  engine,
  /if \(!background && !challengeSafeCapture\)[\s\S]{0,120}autoSaveTimer/,
  'challenge-safe captures must not run the automatic Puppeteer inspection loop',
);
assert.match(
  engine,
  /extensionDir = guest \|\| openAiCapture \|\| challengeSafeCapture[\s\S]{0,80}\? null/,
  'challenge-safe captures must not load the capture extension during human verification',
);

assert.match(engine, /--proxy-bypass-list=localhost;127\.0\.0\.1;\[::1\]/, 'Session Manager proxy must preserve localhost access');
assert.doesNotMatch(engine, /--proxy-bypass-list=<-loopback>/, 'Session Manager must not proxy localhost through the upstream proxy');
assert.match(clientEngine, /--proxy-bypass-list=localhost;127\.0\.0\.1;\[::1\]/, 'userFLOW proxy must preserve localhost access');

console.log('Capture CDP autofill fallback regression: OK');
