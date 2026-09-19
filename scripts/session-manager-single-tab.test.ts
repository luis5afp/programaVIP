import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);
const captureState = readFileSync(
  new URL('../session-manager/browser-engine/capture-state.js', import.meta.url),
  'utf8',
);
const relay = readFileSync(
  new URL('../session-manager/browser-engine/proxy-relay.js', import.meta.url),
  'utf8',
);

assert.match(engine, /args\.push\('about:blank'\)/, 'capture browser must start with one blank tab');
assert.doesNotMatch(engine, /args\.push\(profileUrl\)/, 'capture browser must not launch a second URL tab');
assert.match(engine, /--disable-session-crashed-bubble/, 'crash restore bubble must be disabled');
assert.match(engine, /profile\.exit_type = 'Normal'/, 'profile exit state must be repaired before launch');
assert.match(captureState, /await extra\.close\(\)/, 'extra visible tabs must be closed after navigation');
assert.match(engine, /probeKaizenProxyHttps\(proxy,[\s\S]{0,500}accounts\.google\.com/, 'Google auth destination must complete an HTTPS preflight through the assigned proxy');
assert.match(relay, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/, 'proxy destination preflight should retry transient failures');

console.log('Session Manager single-tab + Google proxy preflight regression: OK');
