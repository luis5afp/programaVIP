import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../cloudflare/lib/core.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
const login = readFileSync(new URL('../src/components/Login.tsx', import.meta.url), 'utf8');

assert.match(core, /fetchSite !== 'same-origin' && fetchSite !== 'none'/);
assert.match(core, /if \(origin\)[\s\S]{0,260}origin !== expected/);
assert.match(core, /else if \(fetchSite !== 'same-origin' && fetchSite !== 'none'\)/);
assert.match(auth, /admin\.login_failed/);
assert.match(auth, /hash_format/);
assert.match(auth, /legacy_scrypt/);
assert.match(auth, /rpc\/userflex_set_admin_password/);
assert.match(login, /ORIGIN_REJECTED/);
assert.match(login, /apiError\.requestId/);
assert.match(login, /No se pudo validar el acceso con el servidor/);

console.log('Admin login compatibility and diagnostics: OK');
