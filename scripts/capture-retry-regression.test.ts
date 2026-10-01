import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profiles = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../cloudflare/lib/profile-sessions.ts', import.meta.url), 'utf8');

assert.match(
  profiles,
  /const result = await api\.profileSessions\.capture\(captureLaunch\.profileId\)/,
  'manual retry must request a fresh capture ticket from the server',
);
assert.match(
  profiles,
  /No se abrió: generar enlace nuevo/,
  'the UI must clearly indicate that retry generates a new capture link',
);
assert.doesNotMatch(
  profiles,
  /onClick=\{\(\) => launchCustomProtocol\(captureLaunch\.launchUrl\)\}/,
  'the retry button must never reuse the one-time launch token',
);
assert.match(
  sessions,
  /Este enlace de captura ya fue aceptado por Session Manager/,
  'replayed capture tokens must return an actionable server message',
);
assert.match(
  profiles,
  /function saveActiveCaptureFromPanel\(\)[\s\S]{0,260}launchCustomProtocol\(captureLaunch\.saveUrl\)/,
  'Admin must expose the existing save protocol so challenge-safe captures can be saved without an injected page overlay',
);
assert.match(
  profiles,
  /Guardar sesión ahora/,
  'capture modal must expose an explicit panel-side save action',
);
assert.match(
  profiles,
  /Cloudflare[\s\S]{0,260}sin automatización/,
  'capture UI must explain that human verification is completed without browser automation',
);

console.log('Capture retry regression: OK');
