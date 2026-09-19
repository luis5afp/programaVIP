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

console.log('Capture retry regression: OK');
