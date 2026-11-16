import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Expiration is issued and enforced by the server, not by the Windows clock.
// The offset is estimated from the server's response at login/validation.
// It is only a convenience for UI timers; server verification is mandatory
// before opening the catalog or any protected browser profile.
export function estimatedServerNow(meta, localNow = Date.now()) {
  const offset = Number(meta?.serverClockOffsetMs);
  return localNow + (Number.isFinite(offset) ? offset : 0);
}

function validSessionDates(meta) {
  const expiresAt = Date.parse(String(meta?.expiresAt || ''));
  const createdAt = Date.parse(String(meta?.createdAt || ''));
  if (!Number.isFinite(expiresAt)) return false;
  if (Number.isFinite(createdAt)) {
    const duration = expiresAt - createdAt;
    if (duration <= 0 || duration > SESSION_MAX_AGE_MS + 1_000) return false;
  }
  return true;
}

export async function saveEncryptedAuthSession(file, token, meta, encryption) {
  if (!encryption?.isEncryptionAvailable?.()) {
    throw Object.assign(
      new Error('Windows no permite almacenar de forma segura la sesión. Comprueba el almacenamiento protegido del sistema.'),
      { code: 'AUTH_SECURE_STORAGE_UNAVAILABLE' },
    );
  }
  const hasCreatedAt = Number.isFinite(Date.parse(String(meta?.createdAt || '')));
  // A Windows clock set ahead or behind must not turn a valid server-issued
  // login into AUTH_INVALID_SESSION. The server independently validates
  // creation, expiry and revocation on every authenticated request.
  if (!TOKEN_PATTERN.test(String(token || '')) || !validSessionDates(meta)) {
    throw Object.assign(
      new Error('El servidor devolvió un token o fechas de sesión incorrectos.'),
      { code: 'AUTH_INVALID_SESSION_DATA' },
    );
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
  // Keep diagnoses separate without ever logging JSON contents, encrypted
  // token bytes, passwords, account identifiers or OS error stack traces.
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
    if (['EPERM', 'EACCES'].includes(String(error?.code))) throw error;
    return { ok: false, reason: 'READ_FAILED' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }
  const ciphertext = data?.token;
  // base64 validation catches a truncated/edited cache before DPAPI decrypt.
  if (typeof ciphertext !== 'string' || ciphertext.length < 16
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext)) {
    return { ok: false, reason: 'INVALID_CIPHERTEXT' };
  }
  let token;
  try {
    token = encryption.decryptString(Buffer.from(ciphertext, 'base64'));
  } catch {
    return { ok: false, reason: 'DECRYPT_FAILED' };
  }
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: 'INVALID_TOKEN' };
  const meta = data?.meta && typeof data.meta === 'object' ? data.meta : {};
  const expiresAt = Date.parse(String(meta.expiresAt || data?.expiresAt || ''));
  const createdAt = Date.parse(String(meta.createdAt || data?.createdAt || ''));
  if (Number.isFinite(createdAt) && Number.isFinite(expiresAt)
    && (expiresAt <= createdAt || expiresAt - createdAt > SESSION_MAX_AGE_MS + 1_000)) {
    return { ok: false, reason: 'INVALID_DATES' };
  }
  // An apparently elapsed expiry is not enough to reject a token: Windows
  // may differ from server time. Never authorize without online validation.
  const locallyExpired = Number.isFinite(expiresAt) && expiresAt <= estimatedServerNow(meta, now);
  if (Number.isFinite(expiresAt)) meta.expiresAt = new Date(expiresAt).toISOString();
  if (Number.isFinite(createdAt)) meta.createdAt = new Date(createdAt).toISOString();
  return {
    ok: true, token, meta,
    legacyExpiry: !Number.isFinite(expiresAt),
    legacyCreatedAt: !Number.isFinite(createdAt),
    locallyExpired,
  };
}
