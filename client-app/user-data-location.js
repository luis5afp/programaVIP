import fs from 'node:fs';
import path from 'node:path';

export const USERFLOW_ROOT_POINTER_NAME = 'userFLOW-session-root.json';

function allowedRoots(appDataDir, defaultDir) {
  const base = path.resolve(appDataDir);
  return Array.from(new Set([
    defaultDir,
    path.join(base, 'userFLEX Client'),
    path.join(base, 'userFLOW'),
    path.join(base, 'userflow-client'),
  ].map((candidate) => path.resolve(candidate))));
}

function existingDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

function scoreRoot(candidate) {
  // Prefer a directory containing the actual previous auth + Chromium state.
  // Never inspect or copy token contents here.
  let points = 0;
  for (const [name, weight] of [['auth.json', 100], ['Local State', 40], ['device.json', 8]]) {
    try {
      if (fs.statSync(path.join(candidate, name)).isFile()) points += weight;
    } catch {}
  }
  return points;
}

export function selectPersistentUserData(appDataDir, defaultDir) {
  const options = allowedRoots(appDataDir, defaultDir);
  const pointerFile = path.join(path.resolve(appDataDir), USERFLOW_ROOT_POINTER_NAME);
  let selected = null;
  try {
    const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    if (pointer?.version === 1 && typeof pointer.directory === 'string') {
      // Ignore unexpected external directories: this local file is only a
      // stable alias for one of userFLOW's historical account directories.
      selected = options.find((item) =>
        item.toLowerCase() === path.resolve(pointer.directory).toLowerCase() && existingDirectory(item)) || null;
    }
  } catch { /* First launch, unconfigured or invalid pointer. */ }
  if (!selected) {
    const available = options.filter(existingDirectory);
    // A past signed-in session and its Chromium local state take precedence.
    available.sort((a, b) => scoreRoot(b) - scoreRoot(a));
    selected = available[0] || path.resolve(defaultDir);
  }
  fs.mkdirSync(selected, { recursive: true });
  // Keep the same root even after a future rename or installer update.
  // This file stores only a local directory, never credentials or tokens.
  try {
    fs.writeFileSync(pointerFile, JSON.stringify({ version: 1, directory: selected }), { encoding: 'utf8', mode: 0o600 });
  } catch { /* An existing stable path still works for this launch. */ }
  return selected;
}
