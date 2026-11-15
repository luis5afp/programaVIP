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
