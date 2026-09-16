import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
const marker = '// userFLOW direct automatic update v1';
let source = (await fs.readFile(bootstrapPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const oldFlow = `    const installerPath = await downloadInstaller(manifest);\n    pendingUpdate = { installerPath, manifest };\n    pushStatus({\n      phase: 'ready-install',\n      message: \`Actualización v\${manifest.version} lista para instalar\`,\n      percent: 100,\n    });`;

  const directFlow = `    const installerPath = await downloadInstaller(manifest);\n    pendingUpdate = { installerPath, manifest };\n    // ${marker}\n    // The updater owns the install transition. Do not depend on renderer DOM\n    // observers or a synthetic click after the verified installer is ready.\n    // launchDownloadedInstaller() re-verifies the file before spawning it and\n    // falls back to the visible retry/install action only if Windows rejects it.\n    await launchDownloadedInstaller();`;

  if (!source.includes(oldFlow)) {
    throw new Error('Could not locate updater ready-install handoff');
  }

  source = source.replace(oldFlow, directFlow);
  await fs.writeFile(bootstrapPath, source, 'utf8');
}

if (!source.includes(marker) || !source.includes('await launchDownloadedInstaller();')) {
  throw new Error('Direct automatic updater launch is not installed');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW direct automatic updater ready.');
