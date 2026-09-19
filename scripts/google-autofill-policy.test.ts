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

console.log('Google/redirect autofill policy: OK');
