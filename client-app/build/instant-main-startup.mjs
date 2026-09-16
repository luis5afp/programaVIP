import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', 'main.js');
const marker = '// userFLOW instant main startup v1';
let source = (await fs.readFile(mainPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const oldReady = `app.whenReady().then(async () => {\n  // // userFLOW fast secure startup v1\n  // Create the UI first. Security ACL maintenance must never block the visible\n  // application startup, especially when Chromium profile storage is large.\n  await getDeviceKey();\n  await loadAuth();\n  createMainWindow();\n  void hardenUserDataPermissions().catch(() => null);\n});`;

  const newReady = `function startUserflowMainUi() {\n  // ${marker}\n  // bootstrap.js imports main.js only after Electron is ready. Create the\n  // visible window synchronously so update/auth/security I/O can never keep\n  // the splash on screen. Renderer bootstrap loads encrypted auth on demand.\n  createMainWindow();\n  void hardenUserDataPermissions().catch(() => null);\n}\n\nif (app.isReady()) {\n  startUserflowMainUi();\n} else {\n  app.whenReady().then(startUserflowMainUi);\n}`;

  if (!source.includes(oldReady)) {
    throw new Error('Could not locate fast secure startup block in main.js');
  }
  source = source.replace(oldReady, newReady);
  await fs.writeFile(mainPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW instant main startup ready.');
