import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url), 'utf8');
const captureState = readFileSync(new URL('../session-manager/browser-engine/capture-state.js', import.meta.url), 'utf8');
const cloudflareWorker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const clientApi = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const profileImages = readFileSync(new URL('../cloudflare/lib/profile-images.ts', import.meta.url), 'utf8');
const clientRenderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const clientStyles = readFileSync(new URL('../client-app/styles.css', import.meta.url), 'utf8');
const adminStyles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

assert.doesNotMatch(admin, /Guardar sesión \/ generar snapshot/, 'Admin must not expose a second save button');
assert.doesNotMatch(admin, /saveCaptureFromAdmin/, 'Admin must not send a second save command for the active ticket');
assert.match(admin, /Guardado automático activo/);
assert.match(admin, /window\.setInterval\(\(\) => void checkSavedSnapshot\(\), 1200\)/);
assert.match(admin, /setCaptureLaunch\(null\)/);
assert.match(admin, /Sesión guardada y verificada correctamente/);
assert.match(admin, /current\.validated_at/);

assert.match(api, /save_url: string/, 'legacy save deep link stays compatible');
assert.match(worker, /userflex-session:\/\/save\?endpoint=/, 'server keeps legacy save deep link');
assert.match(manager, /url\.hostname === 'save'/, 'Session Manager keeps legacy save handling');
assert.match(manager, /completedCaptureFor\(token\)/, 'legacy repeated save stays idempotent');
assert.match(manager, /authenticated: authenticated === true/, 'Session Manager must report confirmed authentication to the backend');
assert.doesNotMatch(
  manager,
  /queueKeeperCheck\(profile\.id, 'capture-complete'\)/,
  'a freshly verified capture must not reopen Chromium immediately just to re-check itself',
);
assert.match(
  worker,
  /last_status: authenticated \? 'healthy' : 'registered'/,
  'a confirmed capture must register Keeper as already healthy',
);
assert.match(worker, /validatedAt: authenticated \? now : null/, 'backend must persist a validation timestamp for confirmed captures');
assert.match(worker, /validated: authenticated/, 'capture completion must report whether the new snapshot is already verified');

assert.match(admin, /Abrir como cliente/, 'profile cards must expose the direct userFLOW client test action');
assert.match(admin, /api\.profileSessions\.clientTest\(profile\.id, clientId\)/, 'direct client action must use the real userFLOW client-test endpoint');
assert.match(admin, /userFLOW para comprobar la configuración real/, 'direct client action must explain that it uses the real client configuration');
assert.match(admin, /network_strategy === 'assigned-proxy'/, 'direct client action must respect client-specific proxy assignments');
assert.match(admin, /Laptop size=\{15\}/, 'compact profile row must show the client-open icon before maintenance actions');

assert.match(admin, /Abrir como invitado/, 'profile cards must expose the guest launch action');
assert.doesNotMatch(admin, /GUEST_MIN_SESSION_MANAGER_VERSION/, 'stale Keeper version must not block guest launch');
assert.doesNotMatch(admin, /Este perfil reporta v\$\{observedVersion\}/, 'stale Keeper version must remain informational only');
assert.match(admin, /La versión guardada por Keeper es informativa y puede estar atrasada/, 'guest launch must explain stale Keeper metadata without blocking');
assert.match(admin, /api\.profileSessions\.guest\(profile\.id\)/, 'guest action must request a one-time Session Manager link');
assert.match(api, /\/guest-launch/, 'Admin API must expose guest launch');
assert.match(worker, /userflex-session-guest:/, 'guest links must use a separate one-time token namespace');
assert.match(worker, /userflex-session:\/\/guest\?endpoint=/, 'backend must return the Session Manager guest protocol');
assert.match(worker, /\/api\/session-manager\/guest-bootstrap/, 'Session Manager must bootstrap guest mode without snapshot delivery');
assert.match(manager, /url\.hostname === 'guest'/, 'Session Manager must handle guest protocol URLs');
assert.match(manager, /engine\(\)\.launchGuest\(\{ profile, proxy \}\)/, 'Session Manager must use the isolated guest engine');
assert.match(engine, /'--guest'/, 'guest Chromium must use the browser guest mode');
assert.match(engine, /temporaryProfile: true/, 'guest Chromium must use disposable profile storage');
assert.match(engine, /app\.getPath\('temp'\)/, 'guest data must live under temporary storage');
assert.match(engine, /launchGuest/, 'capture engine must expose a dedicated guest launcher');

assert.match(cloudflareWorker, /profile-images/, 'Worker must expose same-origin profile images');
assert.match(profileImages, /serveProfileImage/, 'profile image proxy must be implemented');
assert.match(clientApi, /profileImageUrl\(request, profile\)/, 'userFLOW catalog must receive Worker-hosted image URLs');
assert.match(admin, /profileImageSrc\(profile\)/, 'Admin must use Worker-hosted profile image URLs');
assert.match(clientRenderer, /profile-image-fallback/, 'userFLOW must show a clean fallback when a logo cannot load');
assert.match(clientRenderer, /img\.addEventListener\('error'/, 'broken remote logos must not render the browser broken-image glyph');
assert.match(clientStyles, /width: 64px;[\s\S]{0,80}height: 64px;/, 'userFLOW profile logos must be enlarged');
assert.match(clientStyles, /object-position: center/, 'userFLOW profile logos must stay centered');
assert.match(adminStyles, /profile-image-compact \{ width:56px; height:56px;/, 'Admin profile logos must be enlarged');
assert.match(adminStyles, /object-position:center/, 'Admin profile logos must stay centered');

assert.match(engine, /entry\.savedResult/);
assert.match(engine, /entry\.savePromise/);
assert.match(engine, /close\('capture_saved'\)/, 'Chromium must close after successful save');
assert.match(engine, /entry\.stableAuthChecks < 2/, 'automatic save requires stable authentication twice');
assert.match(engine, /confirmAuthenticatedSession/, 'manual fallback save must attempt authentication verification');
assert.match(engine, /saveCapture\(\{ authenticated: true \}\)/, 'autosave must pass its stable authentication proof into the save pipeline');
assert.match(engine, /authenticated,\s*\}\);/, 'capture completion must include the authentication result');
assert.match(engine, /inspectCaptureSession\(debugPort, profile\.url, \{ navigateIfMissing: false \}\)/);
assert.match(engine, /Guardar ahora/, 'Chromium must expose one fallback save button');

assert.match(captureState, /options\?\.navigateIfMissing === false/);
assert.match(captureState, /meaningfulContent/);
assert.match(captureState, /targetOriginMatched/);
assert.match(captureState, /state\.meaningfulContent === true/);
assert.match(captureState, /captureNavigationTarget/, 'Netflix capture must normalize public locale landing URLs');
assert.match(captureState, /target\.pathname = '\/browse'/, 'Netflix capture must enter the authenticated app instead of the public landing page');
assert.match(captureState, /netflixAuthCookies/, 'Netflix verification must require the first-party authentication cookies');
assert.match(captureState, /netflixAppPath/, 'Netflix verification must confirm an authenticated app path');
assert.match(engine, /closeBrowserGracefully/, 'saved captures must attempt a graceful Chromium shutdown before force-kill');

console.log('Automatic single-shot session save regression: OK');
