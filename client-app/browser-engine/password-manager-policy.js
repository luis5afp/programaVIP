import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Only touches the isolated Chromium/Edge user-data directory owned by
// userFLOW. It does not edit the user's normal browser, saved passwords,
// cookie database, snapshots, or OS-wide policy.
export async function disableNativePasswordSavingForManagedProfile(userDataDir) {
  const defaultDir = path.join(userDataDir, 'Default');
  const preferencesPath = path.join(defaultDir, 'Preferences');
  await mkdir(defaultDir, { recursive: true });

  let preferences = {};
  try {
    const parsed = JSON.parse(await readFile(preferencesPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Las preferencias del navegador administrado no son un objeto JSON válido.');
    }
    preferences = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const profile = preferences.profile;
  if (profile !== undefined && (!profile || typeof profile !== 'object' || Array.isArray(profile))) {
    throw new Error('El perfil tiene preferencias inválidas; se conservarán sin sobrescribir.');
  }

  // Chromium credentials_enable_service disables saving but DOES NOT remove
  // existing saved entries or guarantee that browser-native suggestions vanish.
  // The managed userFLOW autofill runs separately through CDP.
  const updated = {
    ...preferences,
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    credentials_enable_passkeys: false,
    profile: {
      ...(profile || {}),
      password_manager_enabled: false,
    },
  };
  if (JSON.stringify(updated) !== JSON.stringify(preferences)) {
    await writeFile(preferencesPath, JSON.stringify(updated), 'utf8');
  }
  return preferencesPath;
}
