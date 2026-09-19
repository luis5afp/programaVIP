import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalGoogleAccountsUrl as clientCanonical,
  credentialAutofillAllowsUrl as clientAllows,
  credentialAutofillOrigins as clientOrigins,
  isTrustedGoogleAccountsHost as clientGoogleHost,
} from '../client-app/browser-engine/credential-policy.js';
import {
  canonicalGoogleAccountsUrl as captureCanonical,
  credentialAutofillAllowsUrl as captureAllows,
  credentialAutofillOrigins as captureOrigins,
  isTrustedGoogleAccountsHost as captureGoogleHost,
} from '../session-manager/browser-engine/credential-policy.js';

for (const [originsFor, allows, trustedHost, canonicalize] of [
  [clientOrigins, clientAllows, clientGoogleHost, clientCanonical],
  [captureOrigins, captureAllows, captureGoogleHost, captureCanonical],
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
  const regional = 'https://accounts.google.com.co/accounts/SetSID?ssdc=1&sidt=abc';
  const canonical = canonicalize(regional);
  assert.ok(canonical, 'regional SetSID must be canonicalized');
  const parsed = new URL(canonical);
  assert.equal(parsed.hostname, 'accounts.google.com');
  assert.equal(parsed.pathname, '/accounts/SetSID');
  assert.equal(parsed.searchParams.get('ssdc'), '1');
  assert.equal(parsed.searchParams.get('sidt'), 'abc');
  assert.equal(canonicalize('https://accounts.google.com.co/v3/signin/identifier'), null);
}

const captureState = readFileSync(
  new URL('../session-manager/browser-engine/capture-state.js', import.meta.url),
  'utf8',
);
const clientState = readFileSync(
  new URL('../client-app/browser-engine/session-state.js', import.meta.url),
  'utf8',
);
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
assert.match(captureState, /canonicalGoogleAccountsUrl\(page\.url\(\)\)/, 'capture must auto-replace the broken regional SetSID URL');
assert.match(clientState, /canonical\.hostname = 'accounts\.google\.com'/, 'userFLOW must auto-replace the broken regional SetSID URL');

console.log('Regional Google Accounts redirect hardening: OK');
