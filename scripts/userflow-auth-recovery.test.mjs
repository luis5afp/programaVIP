import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistRecoverableAuth, recoverAuthCopies } from '../client-app/auth-session-store.js';
import { canonicalAuthFile, authBackupFiles, previousAuthFiles, signedOutMarkerFile } from '../client-app/auth-session-locations.js';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...text].reverse().join(''), 'utf8'),
  decryptString: (bytes) => [...bytes.toString('utf8')].reverse().join(''),
};
const root = await mkdtemp(path.join(tmpdir(), 'userflow-full-session-recovery-'));
const appData = path.join(root, 'Roaming');
const userData = path.join(appData, 'userflow-client');
const primary = canonicalAuthFile(appData);
const backups = authBackupFiles(appData, userData);
const token = 'AUTH_RECOVERY_TEST_TOKEN_0123456789abcdef0123456789';
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString();
const meta = { createdAt, expiresAt, client: { id: 'test' } };
const reader = (file) => import('../client-app/auth-session-cache.js')
  .then((cache) => cache.readEncryptedAuthSession(file, encryption));

try {
  assert.ok(backups.length >= 1);
  const result = await persistRecoverableAuth({
    primary, backups, token, meta, encryption,
  });
  assert.ok(result.copies >= 1, 'must persist a separate encrypted recovery copy');
  const raw = await readFile(primary, 'utf8');
  assert.ok(!raw.includes(token), 'must never write plain credentials');
  const first = await recoverAuthCopies({primary, backups, encryption});
  assert.equal(first.ok, true);
  assert.equal(first.source, 'primary');
  assert.equal(first.token, token);
  assert.equal(first.meta.createdAt, createdAt);
  assert.equal(first.meta.expiresAt, expiresAt);

  await unlink(primary);
  const lost = await recoverAuthCopies({primary, backups, encryption});
  assert.equal(lost.ok, true);
  assert.equal(lost.source, 'backup');
  assert.equal(lost.originalReason, 'MISSING');
  assert.equal(lost.token, token);
  assert.equal(lost.meta.expiresAt, expiresAt,
    'recovery must never extend or renew the original 24-hour expiry');

  await writeFile(primary, '{invalid JSON', 'utf8');
  const corrupted = await recoverAuthCopies({primary, backups, encryption});
  assert.equal(corrupted.ok, true);
  assert.equal(corrupted.source, 'backup');
  assert.equal(corrupted.originalReason, 'DECRYPT_OR_FILE_INVALID');

  // A signed-out session must never be resurrected by a previously created
  // backup. Main checks this marker before calling recoverAuthCopies.
  const main = await readFile(new URL('../client-app/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(await hasSignedOutMarker\(\)\) \{/);
  assert.match(main, /await fs\.writeFile\(signedOutPath\(\), '\{"signedOut":true\}'/);
  assert.match(main, /new Set\(\[authPath\(\), \.\.\.authBackupPaths\(\), \.\.\.previousAuthPaths\(\)\]\)/);
  assert.match(main, /await recoverAuthCopies\(\{[\s\S]*?primary: authPath\(\),[\s\S]*?backups: authBackupPaths\(\)/);
  assert.match(main, /await saveAuth\(restored\.token, restored\.meta\)/,
    'recovered token must be re-encrypted at canonical location');
  assert.match(main, /const data = await catalog\(\{[\s\S]*?quickVerify: input\?\.retry !== true/,
    'even a recovered local token needs online authorization');
  assert.match(main, /restored\.source === 'backup'\s*\? 'RECOVERED_FROM_BACKUP'/,
    'diagnostics must identify backup recovery without logging secrets');
  assert.equal(signedOutMarkerFile(appData), path.join(path.dirname(primary), 'signed-out.json'));
  assert.ok(previousAuthFiles(appData, userData).length >= 1);
  console.log('userFLOW token 24h: normal reopen, absent/corrupt primary recovery, logout guard and server validation: OK');
} finally {
  await rm(root, {recursive: true, force: true});
}
