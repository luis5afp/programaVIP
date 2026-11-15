import assert from 'node:assert/strict';
import { PBKDF2_ITERATIONS, passwordHash, passwordVerify } from '../cloudflare/lib/core.ts';

assert.equal(PBKDF2_ITERATIONS, 100_000, 'Cloudflare Workers rejects PBKDF2 above 100000 iterations');

const password = 'UserFLEX-test-password-123!';
const first = await passwordHash(password);
const second = await passwordHash(password);

assert.match(first, /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/);
assert.match(second, /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/);
assert.notEqual(first, second, 'password hashes must use unique salts');
assert.equal(first.includes(password), false, 'hash must never contain plaintext password');
assert.equal(await passwordVerify(password, first), true);
assert.equal(await passwordVerify('wrong-password', first), false);
assert.equal(await passwordVerify(password, first.replace('$100000

console.log('Password hashing: PBKDF2 round-trip OK');
, '$310000

console.log('Password hashing: PBKDF2 round-trip OK');
)), false,
  'stored iteration parameter must be used rather than assuming the new count');

console.log('Password hashing: PBKDF2 round-trip OK');
