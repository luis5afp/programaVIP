import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  credentialAutofillAllowsUrl as clientAllows,
  credentialAutofillOrigins as clientOrigins,
} from '../client-app/browser-engine/credential-policy.js';
import {
  credentialAutofillAllowsUrl as captureAllows,
  credentialAutofillOrigins as captureOrigins,
} from '../session-manager/browser-engine/credential-policy.js';

for (const [originsFor, allows] of [
  [clientOrigins, clientAllows],
  [captureOrigins, captureAllows],
] as const) {
  const flowOrigins = originsFor('https://flow.google.com/?utm_source=flow', 'custom');
  assert.deepEqual(flowOrigins, [
    'https://flow.google.com',
    'https://accounts.google.com',
  ]);
  assert.equal(allows('https://accounts.google.com/v3/signin/identifier', flowOrigins), true);
  assert.equal(allows('https://accounts.google.com/v3/signin/challenge/pwd?TL=test', flowOrigins), true);
  assert.equal(allows('https://accounts.google.com.co/accounts/SetSID?ssdc=1', flowOrigins), true);
  assert.equal(allows('https://accounts.google.co.uk/accounts/SetSID', flowOrigins), true);
  assert.equal(allows('https://accounts.google.de/accounts/SetSID', flowOrigins), true);
  assert.equal(allows('https://accounts.google.com.evil.example/accounts/SetSID', flowOrigins), false);
  assert.equal(allows('https://flow.google.com/', flowOrigins), true);
  assert.equal(allows('https://evil.example/login', flowOrigins), false);
  assert.equal(allows('https://accounts.google.com.evil.example/login', flowOrigins), false);

  const regularOrigins = originsFor('https://example.com/app', 'custom');
  assert.deepEqual(regularOrigins, ['https://example.com']);
  assert.equal(allows('https://login.example.net/', regularOrigins), false);

  const explicitGoogleProvider = originsFor('https://example.com/app', 'google');
  assert.deepEqual(explicitGoogleProvider, [
    'https://example.com',
    'https://accounts.google.com',
  ]);
}

const clientState = readFileSync(
  new URL('../client-app/browser-engine/session-state.js', import.meta.url),
  'utf8',
);
const clientEngine = readFileSync(
  new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url),
  'utf8',
);
const captureEngine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);

assert.match(
  clientState,
  /allowedOrigins\.includes\(location\.origin\)/,
  'client autofill must accept only the computed trusted origins',
);
assert.match(
  clientEngine,
  /extensionStrategy: runtime\.extensionStrategy/,
  'client launch must pass the profile extension strategy into autofill',
);
assert.match(
  captureEngine,
  /CONFIG\.allowedOrigins/,
  'Session Manager capture must use the same trusted-origin policy',
);
assert.match(
  captureEngine,
  /account\|identifier/,
  'Session Manager must recognize Google identifier fields',
);
assert.match(
  captureEngine,
  /new InputEvent\('input'/,
  'Session Manager must emit a native input event for controlled fields',
);

assert.match(
  clientState,
  /password\|passwd\|passcode/,
  'client autofill must recognize Google Passwd/password variants',
);
assert.match(
  captureEngine,
  /password\|passwd\|passcode/,
  'Session Manager capture must recognize Google Passwd/password variants',
);
assert.match(
  clientState,
  /MutationObserver[\s\S]{0,900}addedNodes[\s\S]{0,900}scheduleFill/,
  'client autofill must follow delayed multi-step login fields without high-frequency attribute scanning',
);
assert.match(
  clientState,
  /browser\.on\('targetcreated', onTarget\)[\s\S]{0,180}browser\.on\('targetchanged', onTarget\)/,
  'client autofill must follow new or replaced Google authentication targets through the password challenge',
);
assert.match(
  clientState,
  /__userflexCredentialAutofillV395[\s\S]{0,220}existingAutomation\?\.refresh/,
  'client autofill reinstrumentation must be idempotent when targetchanged fires repeatedly',
);

assert.match(
  clientState,
  /setInterval\(\(\) => scheduleFill\(0\), 15000\)[\s\S]{0,500}120000/,
  'client autofill must keep a bounded low-frequency fallback for delayed Google login steps',
);
assert.match(
  captureEngine,
  /setInterval\(autofill,1500\)[\s\S]{0,500}600000/,
  'Session Manager capture autofill must stay active for long login flows without high-frequency scanning',
);
assert.doesNotMatch(
  captureEngine,
  /attributeFilter:\['type','name','id','autocomplete','placeholder','aria-label','style','class'\]/,
  'Session Manager capture must not observe style/class mutations on animated pages',
);

console.log('Google/redirect autofill policy: OK');
