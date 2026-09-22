import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url), 'utf8');
const captureState = readFileSync(new URL('../session-manager/browser-engine/capture-state.js', import.meta.url), 'utf8');

assert.doesNotMatch(admin, /Guardar sesión \/ generar snapshot/, 'Admin must not expose a second save button');
assert.doesNotMatch(admin, /saveCaptureFromAdmin/, 'Admin must not send a second save command for the active ticket');
assert.match(admin, /Guardado automático activo/);
assert.match(admin, /window\.setInterval\(\(\) => void checkSavedSnapshot\(\), 1200\)/);
assert.match(admin, /setCaptureLaunch\(null\)/);
assert.match(admin, /Sesión guardada correctamente\. Session Keeper quedó registrado/);

assert.match(api, /save_url: string/, 'legacy save deep link stays compatible');
assert.match(worker, /userflex-session:\/\/save\?endpoint=/, 'server keeps legacy save deep link');
assert.match(manager, /url\.hostname === 'save'/, 'Session Manager keeps legacy save handling');
assert.match(manager, /completedCaptureFor\(token\)/, 'legacy repeated save stays idempotent');

assert.match(engine, /entry\.savedResult/);
assert.match(engine, /entry\.savePromise/);
assert.match(engine, /close\('capture_saved'\)/, 'Chromium must close after successful save');
assert.match(engine, /entry\.stableAuthChecks < 2/, 'automatic save requires stable authentication twice');
assert.match(engine, /inspectCaptureSession\(debugPort, profile\.url, \{ navigateIfMissing: false \}\)/);
assert.match(engine, /Guardar ahora/, 'Chromium must expose one fallback save button');

assert.match(captureState, /options\?\.navigateIfMissing === false/);
assert.match(captureState, /meaningfulContent/);
assert.match(captureState, /targetOriginMatched/);
assert.match(captureState, /state\.meaningfulContent === true/);

console.log('Automatic single-shot session save regression: OK');
