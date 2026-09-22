import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  credentialAutofillAllowsUrl as captureAllows,
  credentialAutofillOrigins as captureOrigins,
} from '../session-manager/browser-engine/credential-policy.js';
import {
  credentialAutofillAllowsUrl as clientAllows,
  credentialAutofillOrigins as clientOrigins,
} from '../client-app/browser-engine/credential-policy.js';

for (const [originsFor, allows] of [
  [captureOrigins, captureAllows],
  [clientOrigins, clientAllows],
]) {
  const origins = originsFor('https://chatgpt.com/', 'custom');
  assert.ok(origins.includes('https://chatgpt.com'));
  assert.ok(origins.includes('https://auth.openai.com'));
  assert.equal(allows('https://auth.openai.com/log-in/password', origins), true);
  assert.equal(allows('https://auth.openai.com.evil.example/log-in', origins), false);
  assert.equal(allows('http://auth.openai.com/log-in', origins), false);
}

const captureState = readFileSync(
  new URL('../session-manager/browser-engine/capture-state.js', import.meta.url),
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

assert.match(captureState, /recoverBlankOpenAIAuth/, 'blank ChatGPT auth transitions must have recovery');
assert.match(captureState, /\/auth\/login_with/, 'ChatGPT login_with route must be detected');
assert.match(captureState, /page\.reload\(\{ waitUntil: 'domcontentloaded'/, 'blank auth page must retry once');
assert.match(captureState, /new URL\('\/auth\/login', 'https:\/\/chatgpt\.com'\)/, 'persistent blank auth page must restart the official ChatGPT login flow');
assert.match(captureState, /if \(openAIAuthFlow\) return null/, 'CDP overlay must not mutate OpenAI auth pages');

assert.match(captureEngine, /openAIAuthFlow=host==='auth\.openai\.com'/, 'capture extension must identify OpenAI auth pages');
assert.match(captureEngine, /if\(openAIAuthFlow\) return;/, 'capture extension overlay must stay off OpenAI auth pages');
assert.match(captureEngine, /host: 'auth\.openai\.com', path: '\/log-in'/, 'Session Manager proxy must preflight OpenAI auth');
assert.match(captureEngine, /host: 'openai\.com', path: '\/'/, 'Session Manager proxy must preflight OpenAI web origin');
assert.match(clientEngine, /host: 'auth\.openai\.com', path: '\/log-in'/, 'userFLOW proxy must preflight OpenAI auth');

console.log('OpenAI / ChatGPT auth-flow hardening: OK');
