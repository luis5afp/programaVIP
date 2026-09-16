import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', 'main.js');
const marker = '// userFLOW fast secure startup v1';
let source = (await fs.readFile(mainPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const oldAcl = `      '/grant:r', \`*\${sid}:(OI)(CI)F\`,\n      '/grant:r', '*S-1-5-18:(OI)(CI)F',\n      '/T', '/C', '/Q',\n    ], { windowsHide: true, timeout: 20000 });`;
  const newAcl = `      '/grant:r', \`*\${sid}:(OI)(CI)F\`,\n      '/grant:r', '*S-1-5-18:(OI)(CI)F',\n      '/Q',\n    ], { windowsHide: true, timeout: 5000 });`;
  if (!source.includes(oldAcl)) throw new Error('Could not locate recursive userData ACL hardening');
  source = source.replace(oldAcl, newAcl);

  const oldReady = `app.whenReady().then(async () => {\n  await hardenUserDataPermissions().catch(() => null);\n  await getDeviceKey();\n  await loadAuth();\n  createMainWindow();\n});`;
  const newReady = `app.whenReady().then(async () => {\n  // ${marker}\n  // Create the UI first. Security ACL maintenance must never block the visible\n  // application startup, especially when Chromium profile storage is large.\n  await getDeviceKey();\n  await loadAuth();\n  createMainWindow();\n  void hardenUserDataPermissions().catch(() => null);\n});`;
  if (!source.includes(oldReady)) throw new Error('Could not locate hardened app.whenReady startup block');
  source = source.replace(oldReady, newReady);

  await fs.writeFile(mainPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW fast secure startup ready.');
