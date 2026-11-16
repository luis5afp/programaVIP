import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveEncryptedAuthSession, readEncryptedAuthSession, estimatedServerNow } from '../client-app/auth-session-cache.js';

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from(v, 'utf8'),
  decryptString: (v) => Buffer.from(v).toString('utf8'),
};
const token = 'A'.repeat(48);
const root = await mkdtemp(path.join(tmpdir(), 'userflow-auth-cache-test-'));
const file = path.join(root, 'auth.json');
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString();
try {
  await saveEncryptedAuthSession(file, token, { createdAt, expiresAt, client: { id: 'test' } }, fakeStorage);
  const savedFile = await readFile(file, 'utf8');
  assert.ok(!savedFile.includes(token), 'the token must never be written in plaintext');
  const saved = JSON.parse(savedFile);
  assert.equal(saved.createdAt, createdAt);
  assert.equal(saved.expiresAt, expiresAt);
  assert.equal(saved.version, 3);
  assert.equal((await readEncryptedAuthSession(file, fakeStorage)).legacyCreatedAt, false);
  assert.deepEqual((await readEncryptedAuthSession(file, fakeStorage)).token, token,
    'the encrypted token must be readable after the process restarts');
  assert.equal((await readEncryptedAuthSession(file, fakeStorage)).legacyExpiry, false);
  const apparentlyExpired = await readEncryptedAuthSession(file, fakeStorage, Date.now() + 26 * 3600_000);
  assert.equal(apparentlyExpired.ok, true,
    'local clock expiry alone must not delete a token without server validation');
  assert.equal(apparentlyExpired.locallyExpired, true,
    'locally elapsed token is flagged for online verification before access');
  await assert.rejects(
    saveEncryptedAuthSession(file, token, { expiresAt }, { isEncryptionAvailable: () => false }),
    { code: 'AUTH_SECURE_STORAGE_UNAVAILABLE' },
    'unavailable secure storage must not silently make the login non-persistent',
  );
  await writeFile(file, '{invalid', 'utf8');
  assert.equal((await readEncryptedAuthSession(file, fakeStorage)).reason,
    'INVALID_JSON', 'malformed cache JSON must fail closed without masking decrypt errors');

  const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../client-app/index.html', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
  const finalizer = readFileSync(new URL('../client-app/build/finalize-client-ui.mjs', import.meta.url), 'utf8');
  assert.match(main, /persistRecoverableAuth\(\{/,
    'login must save encrypted verified recovery copies');
  assert.match(main, /readEncryptedAuthSession\(candidate, safeStorage\)/,
    'the canonical and legacy files must use the same secure decryption');
  assert.match(main, /if \(accessToken && !authError\(error\)\)/,
    'a server/network error must retain an existing saved token');
  assert.match(renderer, /result\?\.pending === true/,
    'on reopening, temporary validation errors must not demand credentials');
  assert.match(html, /id="retry-session-button"/);
  assert.match(finalizer, /pending: true/, 'bootstrap timeout should not show login prematurely');
  assert.match(auth, /select=id,client_id,device_id,created_at,expires_at&token_hash=/,
    'server must return actual token expiry from the database');
  assert.match(worker, /sessionCreatedAt: id\.sessionCreatedAt/, 'catalog and heartbeat must return issue date');
  assert.match(worker, /serverTime: new Date\(\)\.toISOString\(\)/,
    'online session verification must synchronize the Windows clock offset');
  assert.match(worker, /sessionExpiresAt: id\.sessionExpiresAt/,
    'server catalog/heartbeat must return the existing expiry');
  assert.doesNotMatch(worker, /expires_at: sessionExpiresAt/,
    'heartbeat must not extend the 24-hour session clock');
  console.log('userFLOW 24h persistent token, pending connection and logout contracts: OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
