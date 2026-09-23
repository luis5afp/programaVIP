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
const runtime = readFileSync(
  new URL('../cloudflare/lib/profile-runtime.ts', import.meta.url),
  'utf8',
);

assert.match(policy, /OPENAI_AUTH_ORIGIN = 'https:\/\/auth\.openai\.com'/);
assert.match(policy, /isOpenAiServiceHost/);
assert.match(
  policy,
  /isOpenAiServiceHost\(target\.hostname\)[\s\S]{0,160}origins\.add\(OPENAI_AUTH_ORIGIN\)/,
  'ChatGPT profiles must recognize auth.openai.com as an authentication origin',
);

assert.match(captureState, /openAiSecurityHost/);
assert.match(captureState, /currentHost === 'auth\.openai\.com'/);
assert.match(captureState, /currentHost === 'challenges\.cloudflare\.com'/);
assert.match(
  captureState,
  /if \(openAiSecurityHost \|\| openAiLoginPage\) return;/,
  'OpenAI/Cloudflare authentication pages must not receive the persistent DOM overlay or MutationObserver',
);
assert.match(captureState, /const nativeAdvanceOpenAiUsername = async/);
assert.match(captureState, /page\.keyboard\.type\(String\(payload\.username\)/);
assert.match(captureState, /page\.keyboard\.type\(String\(payload\.password\)/);
assert.match(
  captureState,
  /await action\.click\(\{ delay: 80 \}\)/,
  'ChatGPT Continue must use a native Puppeteer click instead of a synthetic DOM click',
);
assert.match(
  captureState,
  /const openAiAuth = openAiAuthPage\(page\.url\(\)\);[\s\S]{0,260}!openAiAuth && credentialAutofillAllowsUrl/,
  'OpenAI auth pages must skip injected autofill/overlay code and use the native fallback only',
);
assert.match(captureState, /recoverBlankChatgptAuth/);

assert.match(engine, /function isOpenAiProfileUrl/);
assert.match(
  engine,
  /const extensionDir = openAiCapture[\s\S]{0,100}\? null/,
  'ChatGPT/OpenAI capture must launch without the temporary userFLEX Chrome extension',
);
assert.match(engine, /--disable-translate/);
assert.match(engine, /Translate,TranslateUI/);
assert.match(
  engine,
  /host: 'auth\.openai\.com'[\s\S]{0,220}host: 'challenges\.cloudflare\.com'/,
  'managed proxies must preflight both OpenAI auth and the Cloudflare challenge host',
);
assert.match(
  engine,
  /exclude_matches:[\s\S]{0,260}challenges\.cloudflare\.com/,
  'temporary extension must defensively exclude OpenAI/Cloudflare security pages',
);


assert.match(engine, /async function devtoolsPageStates/);
assert.match(engine, /function isOpenAiAuthFlowUrl/);
assert.match(engine, /function isOpenAiAppUrl/);
assert.match(
  engine,
  /const authStates = states\.filter[\s\S]{0,360}const challengeActive = authStates\.some\(isOpenAiChallengeState\)[\s\S]{0,160}manualVerificationActive = authStates\.some\(isOpenAiManualVerificationState\)/,
  'Session Manager must identify Cloudflare and OpenAI verification pages before attaching',
);
assert.match(
  engine,
  /no CDP\/Puppeteer attachment while the authentication challenge is active/,
  'interactive OpenAI capture must not attach Puppeteer before authentication completes',
);
assert.match(
  engine,
  /initialUrl: openAiCapture \? profile\.url : 'about:blank'/,
  'OpenAI capture must let Chrome navigate natively instead of using Puppeteer for the initial page',
);


assert.match(engine, /function isOpenAiChallengeState/);
assert.match(engine, /un momento\|just a moment/);
assert.match(engine, /async function activateOpenAiAutomation/);
assert.match(engine, /async function deactivateOpenAiAutomation/);
assert.match(
  engine,
  /challengeActive[\s\S]{0,420}deactivateOpenAiAutomation\(entry\)[\s\S]{0,220}return null;/,
  'Cloudflare challenge must keep Puppeteer detached even if autofill had already been activated',
);
assert.match(engine, /function isOpenAiManualVerificationState/);
assert.match(engine, /email-verification\|verification\|verify\|challenge\|mfa\|otp\|one-time\|code/);
assert.match(engine, /pathname\.startsWith\('\/api\/accounts\/authorize'\)/);
assert.match(
  engine,
  /challengeActive \|\| manualVerificationActive[\s\S]{0,520}deactivateOpenAiAutomation\(entry\)[\s\S]{0,340}return null;/,
  'OpenAI email/MFA verification must stay detached from Puppeteer/CDP',
);
assert.match(
  engine,
  /activateOpenAiAutomation\(entry,[\s\S]{0,520}OpenAI autofill activated on the credential-entry step/,
  'autofill may activate only on credential-entry steps, not verification steps',
);
assert.match(captureState, /const openAiManualVerificationPage =/);
assert.match(
  captureState,
  /if \(openAiAuth && !openAiManualVerification\)[\s\S]{0,120}nativeAdvanceOpenAiUsername/,
  'native credential advance must never run on OpenAI verification/MFA pages',
);
assert.match(engine, /function openAiRouteErrorText/);
assert.match(engine, /async function recoverOpenAiRouteError/);
assert.match(engine, /Route Error 500/);
assert.match(engine, /setBypassServiceWorker\(true\)/);
assert.match(engine, /setCacheEnabled\(false\)/);
assert.match(
  engine,
  /const routeRecovered = await recoverOpenAiRouteError\(entry, profile\.url, log\);[\s\S]{0,80}if \(routeRecovered\) return null;/,
  'OpenAI Route Error 500 must be recovered before autofill/inspection continues',
);
assert.match(runtime, /function isOpenAiProfile/);
assert.match(
  runtime,
  /openAiSnapshot[\s\S]{0,260}storageStrategy: openAiSnapshot \? 'cookies-only' : requestedStorage/,
  'ChatGPT/OpenAI snapshot profiles must restore cookies only',
);

console.log('ChatGPT security-challenge compatibility regression: OK');
