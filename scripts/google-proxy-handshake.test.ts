import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const sharedRelay = readFileSync(
  new URL('../client-app/browser-engine/proxy-relay.js', import.meta.url),
  'utf8',
);

assert.equal(relay, sharedRelay, 'client and Session Manager must share the exact proxy relay implementation');
assert.match(relay, /connectUpstreamWithRetry\(proxy, request\.destination, attempts\)/, 'browser proxy connections must retry transient upstream failures');
assert.match(relay, /tls\.connect\(/, 'proxy preflight must verify a real TLS handshake');
assert.match(relay, /api\.ipify\.org/, 'proxy IP verification must run outside the browser tab');
assert.match(captureEngine, /probeKaizenProxyHttps\(proxy,[\s\S]{0,500}accounts\.google\.com/, 'capture must verify Google Accounts HTTPS before opening Chrome');
assert.match(clientEngine, /probeKaizenProxyHttps\(connection\.proxy,[\s\S]{0,500}accounts\.google\.com/, 'userFLOW must verify Google Accounts HTTPS before opening Chrome');
assert.match(captureEngine, /--disable-quic/, 'proxied Session Manager Chrome must disable QUIC');
assert.match(clientEngine, /--disable-quic/, 'proxied userFLOW Chrome must disable QUIC');
assert.doesNotMatch(
  captureEngine,
  /const publicIp = await browserPublicIp\(debugPort\)/,
  'Session Manager must not expose api.ipify in the visible capture tab',
);
assert.doesNotMatch(
  clientEngine,
  /const detectedIp = await browserPublicIp\(debugPort\)/,
  'userFLOW must not expose api.ipify in the visible managed tab',
);

console.log('Google proxy handshake + hidden diagnostics regression: OK');
