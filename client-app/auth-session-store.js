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
  const recoverable = ['MISSING', 'DECRYPT_OR_FILE_INVALID', 'INVALID_TOKEN', 'INVALID_DATES'];
  if (!recoverable.includes(String(first?.reason || ''))) {
    return { ...first, source: null, originalReason: first?.reason || 'UNKNOWN' };
  }
  const candidates = [
    ...Array.from(new Set(backups)).map((file) => ({ file, source: 'backup' })),
    ...Array.from(new Set(previous)).map((file) => ({ file, source: 'legacy' })),
  ];
  for (const { file, source } of candidates) {
    if (file === primary) continue;
    const restored = await reader(file);
    if (restored?.ok) return { ...restored, source, originalReason: first?.reason || 'UNKNOWN', file };
  }
  return { ...first, source: null, originalReason: first?.reason || 'UNKNOWN' };
}
