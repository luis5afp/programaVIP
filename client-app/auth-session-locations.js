import path from 'node:path';

// Always keep the encrypted session in one folder tied to the Windows account.
// app.getPath('userData') can vary with executable/product naming after an update.
export function canonicalAuthFile(appDataDir) {
  return path.join(appDataDir, 'userFLEX Client', 'auth.json');
}

export function previousAuthFiles(appDataDir, userDataDir) {
  const canonical = canonicalAuthFile(appDataDir);
  return Array.from(new Set([
    path.join(userDataDir, 'auth.json'),
    path.join(appDataDir, 'userFLOW', 'auth.json'),
    path.join(appDataDir, 'userflow-client', 'auth.json'),
  ])).filter((file) => path.resolve(file).toLowerCase() !== path.resolve(canonical).toLowerCase());
}

export function authBackupFiles(appDataDir, userDataDir) {
  const canonical = canonicalAuthFile(appDataDir);
  // Two small encrypted copies of the *same* 24-hour token. Only the server
  // may authorize access; these copies are for recovering from a lost cache
  // file or an installer changing Electron's userData directory.
  return Array.from(new Set([
    path.join(path.dirname(canonical), 'auth-recovery.json'),
    path.join(userDataDir, 'auth-recovery.json'),
  ])).filter((candidate) => path.resolve(candidate).toLowerCase() !== path.resolve(canonical).toLowerCase());
}

export function signedOutMarkerFile(appDataDir) {
  return path.join(path.dirname(canonicalAuthFile(appDataDir)), 'signed-out.json');
}

export function priorSignInMarkerFile(appDataDir) {
  return path.join(path.dirname(canonicalAuthFile(appDataDir)), 'signed-in-once.json');
}
