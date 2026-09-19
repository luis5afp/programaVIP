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
assert.match(engine, /--proxy-bypass-list=localhost;127\.0\.0\.1;\[::1\]/, 'Session Manager proxy must preserve localhost access');
assert.doesNotMatch(engine, /--proxy-bypass-list=<-loopback>/, 'Session Manager must not proxy localhost through the upstream proxy');
assert.match(clientEngine, /--proxy-bypass-list=localhost;127\.0\.0\.1;\[::1\]/, 'userFLOW proxy must preserve localhost access');

console.log('Capture CDP autofill fallback regression: OK');
