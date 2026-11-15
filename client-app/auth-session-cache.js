import fs from 'node:fs/promises';
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
  if (!TOKEN_PATTERN.test(String(token || '')) || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw Object.assign(new Error('El servidor devolvió una sesión no válida.'), { code: 'AUTH_INVALID_SESSION' });
  }
  const ciphertext = encryption.encryptString(token).toString('base64');
  const payload = JSON.stringify({ version: 2, token: ciphertext, meta });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
    // A successful sign-in must not be reported until a decryptable token is
    // confirmed on disk. No plaintext passwords or tokens enter the log.
    const confirmation = JSON.parse(await fs.readFile(file, 'utf8'));
    const restored = encryption.decryptString(Buffer.from(confirmation.token, 'base64'));
    if (restored !== token || confirmation.meta?.expiresAt !== meta.expiresAt) {
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
    const expiresAt = Date.parse(String(meta.expiresAt || ''));
    if (Number.isFinite(expiresAt) && expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
    // Older encrypted caches may not include expiresAt. Do not discard a valid
    // server token; bootstrap always checks it online, and catalog now returns
    // the authoritative expiration so it can be persisted.
    return { ok: true, token, meta, legacyExpiry: !Number.isFinite(expiresAt) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
    if (['EPERM', 'EACCES'].includes(String(error?.code))) throw error;
    return { ok: false, reason: 'DECRYPT_OR_FILE_INVALID' };
  }
}
