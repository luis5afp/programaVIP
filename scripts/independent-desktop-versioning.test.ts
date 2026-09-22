import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const clientWorkflow = readFileSync(new URL('../.github/workflows/build-client-app.yml', import.meta.url), 'utf8');
const sessionWorkflow = readFileSync(new URL('../.github/workflows/build-session-manager.yml', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8');
const clientPackage = readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8');
const installer = readFileSync(new URL('../client-app/build/installer.nsh', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');
const devices = readFileSync(new URL('../src/views/DevicesView.tsx', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(clientWorkflow, /must use the same version/i);
assert.doesNotMatch(sessionWorkflow, /must use the same version/i);
assert.doesNotMatch(clientWorkflow, /Build bundled Session Manager/);
assert.doesNotMatch(clientWorkflow, /Stage Session Manager for userFLOW installer/);
assert.doesNotMatch(clientWorkflow, /session-manager\/\*\*/);
assert.doesNotMatch(clientPackage, /build\/session-manager\/userFLEX-Session-Manager-Setup\.exe/);
assert.doesNotMatch(installer, /userFLEX Session Manager\.exe/);
assert.doesNotMatch(installer, /Session-Manager-Setup\.exe/);

assert.match(deployWorkflow, /EXPECTED_USERFLOW/);
assert.match(deployWorkflow, /MIN_SESSION_MANAGER/);
assert.match(deployWorkflow, /session-manager-v\$MIN_SESSION_MANAGER/);

assert.match(auth, /userflow_version/);
assert.match(auth, /userflow_version_seen_at/);
assert.match(sessions, /session_manager_version/);
assert.match(sessions, /session_manager_version_seen_at/);
assert.match(devices, /userFLOW/);
assert.match(profiles, /Session Manager: v/);
assert.doesNotMatch(profiles, /Session Manager v\d+\.\d+\.\d+ · userFLOW v/);

console.log('Independent userFLOW / Session Manager versioning: OK');
