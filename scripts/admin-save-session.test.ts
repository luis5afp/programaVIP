import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url), 'utf8');
const captureState = readFileSync(new URL('../session-manager/browser-engine/capture-state.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  admin,
  /Guardar sesión \/ generar snapshot/,
  'Admin must not expose a second save button while Chromium is active',
);
assert.doesNotMatch(
  admin,
  /saveCaptureFromAdmin/,
  'Admin must not send a second Save protocol for an active capture',
);
assert.match(
  admin,
  /Guardado automático activo/,
  'Admin must explain that the capture saves automatically',
);
assert.match(
  admin,
  /window\.setInterval\(\(\) => void checkSavedSnapshot\(\), 1200\)/,
  'Admin must watch the server for the new snapshot',
);
assert.match(
  admin,
  /setCaptureLaunch\(null\)/,
  'Admin must close the capture modal once the snapshot is confirmed',
);
assert.match(
  admin,
  /Sesión guardada correctamente\. Session Keeper quedó registrado/,
  'Admin must show a clear success confirmation after automatic save',
);

assert.match(api, /save_url: string/, 'save deep link remains available for backward compatibility');
assert.match(worker, /userflex-session:\/\/save\?endpoint=/, 'server keeps the one-use save deep link for older Session Manager builds');
assert.match(manager, /url\.hostname === 'save'/, 'Session Manager keeps backward-compatible save action handling');
assert.match(manager, /completedCaptureFor\(token\)/, 'repeated legacy save commands remain idempotent');

assert.match(engine, /entry\.savedResult/, 'capture engine must remember the completed save result');
assert.match(engine, /entry\.savePromise/, 'capture engine must coalesce simultaneous save attempts');
assert.match(
  engine,
  /setTimeout\(\(\) => \{\s*if \(active === entry\) void close\('capture_saved'\)/,
  'Chromium must close automatically after a successful save',
);
assert.match(
  engine,
  /entry\.stableAuthChecks < 2/,
  'automatic save must require two stable authenticated checks',
);
assert.match(
  engine,
  /inspectCaptureSession\(debugPort, profile\.url\)/,
  'automatic save must use live browser session inspection',
);
assert.match(engine, /Guardar ahora/, 'Chromium must retain a single manual fallback save button');

assert.match(captureState, /meaningfulContent/);
assert.match(captureState, /targetOriginMatched/);
assert.match(
  captureState,
  /state\.meaningfulContent === true/,
  'blank/login pages must not be considered safe for automatic capture',
);

console.log('Automatic single-shot session save regression: OK');
