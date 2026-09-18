import assert from 'node:assert/strict';
import { passwordHash, passwordVerify } from '../cloudflare/lib/core.ts';

const password = 'UserFLEX-test-password-123!';
const first = await passwordHash(password);
const second = await passwordHash(password);

assert.match(first, /^pbkdf2-sha256\$310000\$[^$]+\$[^$]+$/);
assert.match(second, /^pbkdf2-sha256\$310000\$[^$]+\$[^$]+$/);
assert.notEqual(first, second, 'password hashes must use unique salts');
assert.equal(first.includes(password), false, 'hash must never contain plaintext password');
assert.equal(await passwordVerify(password, first), true);
assert.equal(await passwordVerify('wrong-password', first), false);

console.log('Password hashing: PBKDF2 round-trip OK');
