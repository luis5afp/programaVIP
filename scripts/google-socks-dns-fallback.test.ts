import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const relay = readFileSync(
  new URL('../session-manager/browser-engine/proxy-relay.js', import.meta.url),
  'utf8',
);
const clientRelay = readFileSync(
  new URL('../client-app/browser-engine/proxy-relay.js', import.meta.url),
  'utf8',
);

assert.equal(relay, clientRelay, 'desktop relays must stay identical');
assert.match(relay, /dns\.lookup\(host, \{ all: true, verbatim: true \}\)/, 'regional Google Accounts must have a local DNS fallback');
assert.match(relay, /proxy\.type === 'socks5'[\s\S]{0,180}isGoogleAccountsHost\(host\)/, 'DNS fallback must be limited to Google Accounts over SOCKS5');
assert.match(relay, /connectUpstream\(proxy, \{ \.\.\.destination, host: address \}\)/, 'resolved Google IPs must still travel through the configured proxy');

console.log('Google Accounts SOCKS DNS fallback regression: OK');
