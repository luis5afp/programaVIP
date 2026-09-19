import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  credentialAutofillAllowsUrl as clientAllows,
  credentialAutofillOrigins as clientOrigins,
  isTrustedGoogleAccountsHost as clientGoogleHost,
} from '../client-app/browser-engine/credential-policy.js';
import {
  credentialAutofillAllowsUrl as captureAllows,
  credentialAutofillOrigins as captureOrigins,
  isTrustedGoogleAccountsHost as captureGoogleHost,
} from '../session-manager/browser-engine/credential-policy.js';

for (const [originsFor, allows, trustedHost] of [
  [clientOrigins, clientAllows, clientGoogleHost],
  [captureOrigins, captureAllows, captureGoogleHost],
]) {
  const origins = originsFor('https://flow.google.com/about', 'google');
  assert.equal(trustedHost('accounts.google.com.co'), true);
  assert.equal(trustedHost('accounts.google.co.uk'), true);
  assert.equal(trustedHost('accounts.google.de'), true);
  assert.equal(trustedHost('accounts.google.com.evil.example'), false);
  assert.equal(allows('https://accounts.google.com.co/accounts/SetSID?ssdc=1', origins), true);
  assert.equal(allows('https://accounts.google.co.uk/accounts/SetSID', origins), true);
  assert.equal(allows('https://accounts.google.de/accounts/SetSID', origins), true);
  assert.equal(allows('http://accounts.google.com.co/accounts/SetSID', origins), false);
}

const captureEngine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);
const clientEngine = readFileSync(
  new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url),
  'utf8',
);
const relay = readFileSync(
  new URL('../session-manager/browser-engine/proxy-relay.js', import.meta.url),
  'utf8',
);

assert.match(captureEngine, /accounts\.google\.com\.co/, 'capture must preflight the observed Colombia Google Accounts redirect');
assert.match(clientEngine, /accounts\.google\.com\.co/, 'userFLOW must preflight the observed Colombia Google Accounts redirect');
assert.match(relay, /isGoogleAccountsHost\(request\.destination\.host\) \? 7 : 3/, 'regional Google Accounts relay connections must receive extended retries');

console.log('Regional Google Accounts redirect hardening: OK');
