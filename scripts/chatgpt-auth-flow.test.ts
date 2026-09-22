import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy = readFileSync(
  new URL('../session-manager/browser-engine/credential-policy.js', import.meta.url),
  'utf8',
);
const captureState = readFileSync(
  new URL('../session-manager/browser-engine/capture-state.js', import.meta.url),
  'utf8',
);
const engine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);

assert.match(policy, /OPENAI_AUTH_ORIGIN = 'https:\/\/auth\.openai\.com'/);
assert.match(policy, /isOpenAiServiceHost/);
assert.match(
  policy,
  /isOpenAiServiceHost\(target\.hostname\)[\s\S]{0,160}origins\.add\(OPENAI_AUTH_ORIGIN\)/,
  'ChatGPT profiles must authorize autofill on auth.openai.com',
);

assert.match(captureState, /const nativeAdvanceOpenAiUsername = async/);
assert.match(
  captureState,
  /await action\.click\(\{ delay: 80 \}\)/,
  'ChatGPT Continue must use a native Puppeteer click instead of a synthetic DOM click',
);
assert.match(
  captureState,
  /page\.waitForFunction\([\s\S]{0,700}type === 'password'/,
  'native Continue must wait for URL change or password field',
);
assert.match(captureState, /recoverBlankChatgptAuth/);
assert.match(captureState, /current\.pathname !== '\/auth\/login_with'/);
assert.match(captureState, /page\.reload\(\{ waitUntil: 'domcontentloaded'/);
assert.match(
  captureState,
  /fallback\.searchParams\.set\('login_hint', loginHint\)/,
  'blank ChatGPT login_with recovery must preserve the username hint',
);
assert.doesNotMatch(
  captureState,
  /maybeAdvanceOpenAiUsername/,
  'page-injected automation must not synthetically advance ChatGPT login',
);

assert.match(
  engine,
  /host: 'auth\.openai\.com',[\s\S]{0,160}path: '\/'/,
  'managed proxies must preflight OpenAI authentication host',
);
assert.doesNotMatch(
  engine,
  /maybeAdvanceOpenAiUsername/,
  'temporary capture extension must not compete with native ChatGPT navigation',
);

console.log('ChatGPT auth recovery regression: OK');
