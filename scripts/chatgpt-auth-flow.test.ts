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

assert.match(captureState, /const openAiLoginPage =/);
assert.match(captureState, /usernameContinueAction/);
assert.match(captureState, /maybeAdvanceOpenAiUsername/);
assert.match(
  captureState,
  /!values\?\.usernameInput \|\| values\.passwordInput/,
  'automatic Continue must only happen before the password step',
);
assert.match(captureState, /recoverBlankChatgptAuth/);
assert.match(captureState, /current\.pathname !== '\/auth\/login_with'/);
assert.match(captureState, /page\.reload\(\{ waitUntil: 'domcontentloaded'/);
assert.match(
  captureState,
  /https:\/\/chatgpt\.com\/auth\/login\?callback_path=%2F/,
  'blank ChatGPT login_with must fall back to the clean login route',
);

assert.match(
  engine,
  /host: 'auth\.openai\.com',[\s\S]{0,160}path: '\/'/,
  'managed proxies must preflight OpenAI authentication host',
);
assert.match(engine, /openAiLoginPage=/);
assert.match(engine, /maybeAdvanceOpenAiUsername/);

console.log('ChatGPT auth recovery regression: OK');
