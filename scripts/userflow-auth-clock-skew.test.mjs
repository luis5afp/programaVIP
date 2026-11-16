import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { saveEncryptedAuthSession, readEncryptedAuthSession, estimatedServerNow } from '../client-app/auth-session-cache.js';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text, 'utf8'),
  decryptString: (ciphertext) => ciphertext.toString('utf8'),
};
const root = await mkdtemp(path.join(os.tmpdir(), 'userflow-clock-skew-'));
const serverNow = Date.now();
const createdAt = new Date(serverNow).toISOString();
const expiresAt = new Date(serverNow + 24 * 60 * 60 * 1000).toISOString();
const threeDays = 3 * 24 * 60 * 60 * 1000;
const token = 'A'.repeat(43);
try {
  for (const [name, localNow] of [
    ['windows-ahead-by-three-days', serverNow + threeDays],
    ['windows-behind-by-three-days', serverNow - threeDays],
  ]) {
    const file = path.join(root, name, 'auth.json');
    const meta = {
      createdAt, expiresAt,
      serverClockOffsetMs: serverNow - localNow,
    };
    // The desktop session may have an incorrect clock, but the server
    // minted a coherent 24-hour token and will validate it before access.
    await saveEncryptedAuthSession(file, token, meta, encryption);
    const restored = await readEncryptedAuthSession(file, encryption, localNow);
    assert.equal(restored.ok, true, name + ' must restore the saved token');
    assert.equal(restored.token, token);
    assert.equal(restored.locallyExpired, false, name + ' must use server-aligned time');
    assert.equal(restored.meta.createdAt, createdAt);
    assert.equal(restored.meta.expiresAt, expiresAt);
    assert.ok(Math.abs(estimatedServerNow(restored.meta, localNow) - serverNow) < 5_000);
    const afterExpiry = await readEncryptedAuthSession(file, encryption, localNow + 26 * 60 * 60 * 1000);
    assert.equal(afterExpiry.locallyExpired, true,
      'the time offset must not extend a 24-hour token after its original expiry');
  }
  const bad = { createdAt, expiresAt: new Date(serverNow + 48 * 60 * 60 * 1000).toISOString() };
  await assert.rejects(
    saveEncryptedAuthSession(path.join(root, 'bad', 'auth.json'), token, bad, encryption),
    { code: 'AUTH_INVALID_SESSION_DATA' },
    'invalid server timestamps must be rejected without relying on Windows time',
  );
  const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
  const serverAuth = readFileSync(new URL('../cloudflare/lib/auth.ts', import.meta.url), 'utf8');
  assert.match(main, /serverClockOffsetMs: \(\(\) => \{/);
  assert.match(main, /estimatedServerNow\(authMeta\)/);
  assert.match(main, /const data = await catalog\(\{[\s\S]*?quickVerify: input\?\.retry !== true[\s\S]*?deferImages: true[\s\S]*?\}\);[\s\S]*?return \{ authenticated: true/,
    'reopening must confirm the token online before opening any profiles');
  assert.match(worker, /serverTime: new Date\(\)\.toISOString\(\)/);
  assert.match(serverAuth, /createdAt: sessionCreatedAt,[\s\S]*serverTime: new Date\(\)\.toISOString\(\)/);
  console.log('userFLOW 24h token: server clock survives Windows time skew and requires online validation: OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
