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

console.log('Google profile configuration hardening: OK');
