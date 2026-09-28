import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
const installerPath = path.resolve(here, 'installer.nsh');
const source = (await fs.readFile(bootstrapPath, 'utf8')).replace(/\r\n/g, '\n');
const installer = (await fs.readFile(installerPath, 'utf8')).replace(/\r\n/g, '\n');

// Build guard for the updater contract:
// 1) startup checks and downloads automatically,
// 2) the verified installer launches automatically in NSIS silent mode,
// 3) the silent NSIS installer relaunches the newly installed userFLOW,
// 4) the visible install button remains only as an interactive fallback.
const updateStart = source.indexOf('async function checkUpdatesAndContinue()');
const updateEnd = source.indexOf('\ncreateSplash();', updateStart);
if (updateStart < 0 || updateEnd < 0) throw new Error('Could not locate updater flow');
const updater = source.slice(updateStart, updateEnd);

if (!updater.includes('const installerPath = await downloadInstaller(manifest);')) {
  throw new Error('Automatic updater download handoff is missing');
}
if (!updater.includes('await launchDownloadedInstaller({ silent: true });')) {
  throw new Error('Updater must automatically launch the verified installer');
}
if (!source.includes("const args = silent ? ['/S'] : [];")) {
  throw new Error('Automatic installer must use NSIS silent mode');
}
if (!source.includes("url === 'userflex-update://install'") || !source.includes('void launchDownloadedInstaller();')) {
  throw new Error('Interactive fallback install button is missing');
}

if (!installer.includes('!macro customInstall')
    || !installer.includes('IfSilent 0 +2')
    || !installer.includes('ExecShell "open" "$INSTDIR\\userFLEX Client.exe" "--userflow-updated"')) {
  throw new Error('Silent updater must relaunch the installed userFLOW executable');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW automatic updater install guard ready.');
