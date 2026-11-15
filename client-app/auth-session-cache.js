import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export async function saveEncryptedAuthSession(file, token, meta, encryption) {
  if (!encryption?.isEncryptionAvailable?.()) {
    throw Object.assign(
      new Error('Windows no permite almacenar de forma segura la sesión. Comprueba el almacenamiento protegido del sistema.'),
      { code: 'AUTH_SECURE_STORAGE_UNAVAILABLE' },
    );
  }
  const expiry = Date.parse(String(meta?.expiresAt || ''));
  const createdAt = Date.parse(String(meta?.createdAt || ''));
  const hasCreatedAt = Number.isFinite(createdAt);
  if (!TOKEN_PATTERN.test(String(token || '')) || !Number.isFinite(expiry) || expiry <= Date.now()
    || (hasCreatedAt && (createdAt > Date.now() + 60_000 || expiry > createdAt + 24 * 60 * 60 * 1000 + 1_000))) {
    throw Object.assign(new Error('El servidor devolvió una sesión no válida.'), { code: 'AUTH_INVALID_SESSION' });
  }
  const ciphertext = encryption.encryptString(token).toString('base64');
  // The creation/expiration dates are stored alongside the encrypted token;
  // the dates aren't secrets, while the token remains protected by Windows.
  // v2 files with only meta.expiresAt remain readable during migration.
  const payload = JSON.stringify({
    version: 3, token: ciphertext,
    createdAt: hasCreatedAt ? meta.createdAt : null,
    expiresAt: meta.expiresAt,
    meta,
  });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
    // A successful sign-in must not be reported until a decryptable token is
    // confirmed on disk. No plaintext passwords or tokens enter the log.
    const confirmation = JSON.parse(await fs.readFile(file, 'utf8'));
    const restored = encryption.decryptString(Buffer.from(confirmation.token, 'base64'));
    if (restored !== token
      || confirmation.expiresAt !== meta.expiresAt
      || confirmation.createdAt !== (hasCreatedAt ? meta.createdAt : null)) {
      throw Object.assign(new Error('No se pudo verificar el acceso guardado.'), { code: 'AUTH_SAVE_VERIFY_FAILED' });
    }
  } finally {
    await fs.unlink(temporary).catch(() => null);
  }
}

export async function readEncryptedAuthSession(file, encryption, now = Date.now()) {
  if (!encryption?.isEncryptionAvailable?.()) return { ok: false, reason: 'ENCRYPTION_UNAVAILABLE' };
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
    const token = encryption.decryptString(Buffer.from(data?.token || '', 'base64'));
    if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: 'INVALID_TOKEN' };
    const meta = data?.meta && typeof data.meta === 'object' ? data.meta : {};
    const expiresAt = Date.parse(String(meta.expiresAt || data?.expiresAt || ''));
    const createdAt = Date.parse(String(meta.createdAt || data?.createdAt || ''));
    if (Number.isFinite(expiresAt) && expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
    if (Number.isFinite(createdAt) && Number.isFinite(expiresAt)
      && (createdAt > now + 60_000 || expiresAt > createdAt + 24 * 60 * 60 * 1000 + 1_000)) {
      return { ok: false, reason: 'INVALID_DATES' };
    }
    // Do not silently renew missing dates. Server catalog fills them
    // from the original session row during online verification.
    if (Number.isFinite(expiresAt)) meta.expiresAt = new Date(expiresAt).toISOString();
    if (Number.isFinite(createdAt)) meta.createdAt = new Date(createdAt).toISOString();
    return {
      ok: true, token, meta,
      legacyExpiry: !Number.isFinite(expiresAt),
      legacyCreatedAt: !Number.isFinite(createdAt),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
    if (['EPERM', 'EACCES'].includes(String(error?.code))) throw error;
    return { ok: false, reason: 'DECRYPT_OR_FILE_INVALID' };
  }
}
