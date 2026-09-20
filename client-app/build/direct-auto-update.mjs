import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
let source = (await fs.readFile(bootstrapPath, 'utf8')).replace(/\r\n/g, '\n');

// Build guard for the updater contract:
// 1) startup checks the latest manifest automatically,
// 2) a newer installer downloads and is SHA-256 verified automatically,
// 3) installation begins only after the user clicks "Instalar actualización".
const readyFlow = `    const installerPath = await downloadInstaller(manifest);
    pendingUpdate = { installerPath, manifest };
    pushStatus({
      phase: 'ready-install',
      message: \`Actualización v\${manifest.version} lista para instalar\`,
      percent: 100,
    });`;

const legacyDirectMarker = '// userFLOW direct automatic update v1';
if (source.includes(legacyDirectMarker)) {
  const directFlow = `    const installerPath = await downloadInstaller(manifest);
    pendingUpdate = { installerPath, manifest };
    // ${legacyDirectMarker}
    // The updater owns the install transition. Do not depend on renderer DOM
    // observers or a synthetic click after the verified installer is ready.
    // launchDownloadedInstaller() re-verifies the file before spawning it and
    // falls back to the visible retry/install action only if Windows rejects it.
    await launchDownloadedInstaller();`;
  if (!source.includes(directFlow)) {
    throw new Error('Legacy direct updater marker exists but its automatic launch block was not recognized');
  }
  source = source.replace(directFlow, readyFlow);
  await fs.writeFile(bootstrapPath, source, 'utf8');
}

if (!source.includes(readyFlow)) {
  throw new Error('Manual updater ready-install handoff is missing');
}

const updateStart = source.indexOf('async function checkUpdatesAndContinue()');
const updateEnd = source.indexOf('\ncreateSplash();', updateStart);
if (updateStart < 0 || updateEnd < 0) throw new Error('Could not locate updater flow');
const updater = source.slice(updateStart, updateEnd);
if (updater.includes('await launchDownloadedInstaller()')) {
  throw new Error('Updater must not launch the installer automatically after download');
}
if (!source.includes("url === 'userflex-update://install'") || !source.includes('void launchDownloadedInstaller();')) {
  throw new Error('Manual install button handler is missing');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW manual updater install guard ready.');
