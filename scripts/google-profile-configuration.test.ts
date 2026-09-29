import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sessions = readFileSync(
  new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url),
  'utf8',
);

assert.match(
  sessions,
  /googleProfile = googleProfile \|\| host === 'google\.com' \|\| host\.endsWith\('\.google\.com'\)/,
  'Admin validation must recognize Google profiles by host',
);
assert.match(
  sessions,
  /modo snapshot el autofill es solo respaldo[\s\S]{0,120}modo híbrido/,
  'Admin validation must explain when Google autofill is only optional',
);
assert.match(
  sessions,
  /Credenciales cifradas listas para autofill en Google\/Google Accounts/,
  'hybrid Google profiles must report managed autofill readiness',
);
assert.match(
  sessions,
  /await liveValidateCaptureProxy\(env, network\.proxy\)/,
  'Admin validation must re-check the selected proxy live instead of trusting stale state',
);

assert.match(
  sessions,
  /const runtime = runtimeForProfile\(profile\);[\s\S]{0,120}const authStrategy = runtime\.authStrategy;/,
  'Session Manager bootstrap must use the effective runtime policy so Google Flow snapshot profiles become hybrid',
);
assert.match(
  sessions,
  /\/api\/session-keeper\/bootstrap[\s\S]{0,6500}updatedAt: credentials\.updated_at \|\| null/,
  'Session Keeper must receive the credential revision so stale local Google identities are reset after an admin edit',
);

const captureEngine = readFileSync(
  new URL('../session-manager/browser-engine/kaizen-capture-engine.js', import.meta.url),
  'utf8',
);
assert.match(
  captureEngine,
  /resetCaptureProfileForCredentialChange[\s\S]{0,1800}fs\.existsSync\(userDataDir\)[\s\S]{0,2200}commitCredentialMarker\(credentialState\)/,
  'Session Manager must verify the old local profile is deleted before accepting the new credential marker',
);
assert.doesNotMatch(
  captureEngine,
  /credentialMarkerChanged\(/,
  'the old marker-first credential reset path must not remain',
);

console.log('Google profile configuration hardening: OK');
