import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
const marker = '// userFLOW splash window race guard v1';
let source = (await fs.readFile(bootstrapPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const unsafe = `  splashWindow.once('ready-to-show', () => {\n    if (!splashWindow?.isDestroyed()) splashWindow.show();\n  });`;
  const safe = `  // ${marker}\n  // Capture the exact BrowserWindow instance. The global splashWindow can be\n  // cleared by startMain() before Electron dispatches ready-to-show; checking\n  // optional chaining and then dereferencing the global caused null.show().\n  const splash = splashWindow;\n  splash.once('ready-to-show', () => {\n    if (splashWindow !== splash || splash.isDestroyed()) return;\n    splash.show();\n  });\n  splash.once('closed', () => {\n    if (splashWindow === splash) {\n      splashWindow = null;\n      splashReady = false;\n    }\n  });`;

  if (!source.includes(unsafe)) throw new Error('Could not locate unsafe splash ready-to-show handler');
  source = source.replace(unsafe, safe);
  await fs.writeFile(bootstrapPath, source, 'utf8');
}

if (source.includes("if (!splashWindow?.isDestroyed()) splashWindow.show();")) {
  throw new Error('Unsafe splash global dereference is still present');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW splash window race guard ready.');
