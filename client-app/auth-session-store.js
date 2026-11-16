import { saveEncryptedAuthSession, readEncryptedAuthSession } from './auth-session-cache.js';

// Save the primary encrypted token and independently verified encrypted copies.
// Backups are best-effort: failure never changes the authorized session or
// replaces a good primary with an unreadable file.
export async function persistRecoverableAuth({
  primary, backups = [], token, meta, encryption, onBackupError = null,
}) {
  await saveEncryptedAuthSession(primary, token, meta, encryption);
  let copies = 0;
  for (const file of Array.from(new Set(backups)).filter((file) => file !== primary)) {
    try {
      await saveEncryptedAuthSession(file, token, meta, encryption);
      copies += 1;
    } catch (error) {
      if (typeof onBackupError === 'function') {
        await Promise.resolve().then(() => onBackupError(error)).catch(() => null);
      }
    }
  }
  return { copies };
}

// Only trust a restored token after server validation. Local disk copies do
// not grant access, extend expiry or suppress server-side revocation checks.
export async function recoverAuthCopies({ primary, backups = [], previous = [], read = null, encryption }) {
  const reader = read || ((file) => readEncryptedAuthSession(file, encryption));
  const first = await reader(primary);
  if (first?.ok) return { ...first, source: 'primary', originalReason: null };
  // A permission error on the primary cache must not hide a separately
  // readable, encrypted backup. The session still needs server validation.
  const recoverable = [
    'MISSING', 'DECRYPT_OR_FILE_INVALID', 'INVALID_JSON', 'INVALID_CIPHERTEXT',
    'DECRYPT_FAILED', 'READ_FAILED', 'INVALID_TOKEN', 'INVALID_DATES',
    'ACCESS_DENIED', 'LOAD_FAILED',
  ];
  if (!recoverable.includes(String(first?.reason || ''))) {
    return { ...first, source: null, originalReason: first?.reason || 'UNKNOWN' };
  }
  const candidates = [
    ...Array.from(new Set(backups)).map((file) => ({ file, source: 'backup' })),
    ...Array.from(new Set(previous)).map((file) => ({ file, source: 'legacy' })),
  ];
  let accessDenied = first?.reason === 'ACCESS_DENIED';
  for (const { file, source } of candidates) {
    if (file === primary) continue;
    let restored;
    try {
      restored = await reader(file);
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(String(error?.code || ''))) throw error;
      restored = { ok: false, reason: 'ACCESS_DENIED' };
    }
    if (restored?.ok) return { ...restored, source, originalReason: first?.reason || 'UNKNOWN', file };
    if (restored?.reason === 'ACCESS_DENIED') accessDenied = true;
  }
  // If any cache could not be read, don't call it a missing cache. In
  // particular, a previous successful login with a locked backup should
  // produce an actionable permission error, not a fresh-login prompt.
  return {
    ...first,
    reason: accessDenied ? 'ACCESS_DENIED' : first?.reason,
    source: null,
    originalReason: first?.reason || 'UNKNOWN',
  };
}
