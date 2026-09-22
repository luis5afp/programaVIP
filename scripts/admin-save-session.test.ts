import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url), 'utf8');

assert.match(admin, /Guardar sesión \/ generar snapshot/, 'Admin must expose an explicit save-session button');
assert.match(admin, /saveCaptureFromAdmin/, 'Admin save button must trigger the local Session Manager command');
assert.match(api, /save_url: string/, 'Admin API client must receive the save deep link');
assert.match(worker, /userflex-session:\/\/save\?endpoint=/, 'capture API must issue a save deep link bound to the capture token');
assert.match(manager, /url\.hostname === 'save'/, 'Session Manager must accept the save action');
assert.match(manager, /sameCaptureToken\(activeCaptureToken, token\)/, 'save action must be bound to the active capture token');
assert.match(manager, /activeCaptureToken = token;/, 'capture ticket must become active before Chromium startup completes');
assert.match(manager, /captureStartState = \{ token, promise: launchPromise \}/, 'Session Manager must track the in-flight Chromium startup for the same ticket');
assert.match(manager, /await waitForCaptureStart\(token\)/, 'save must wait for a matching capture that is still starting');
assert.match(manager, /completedCaptureFor\(token\)/, 'repeated save commands for the same completed ticket must be idempotent');
assert.match(admin, /const beforeSaveRows = await api\.profileSessions\.list\(\)/, 'Admin must check whether Chromium already saved before sending a Save protocol');
assert.match(admin, /Sesión ya guardada correctamente/, 'Admin must report an already-completed overlay save without opening an error window');
assert.match(engine, /async function saveActive\(\)/, 'capture engine must expose a save-active operation');
assert.match(engine, /return active\.saveCapture\(\)/, 'save-active must reuse the exact capture material pipeline');

console.log('Admin save-session regression: OK');
