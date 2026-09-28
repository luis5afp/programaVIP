import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');
const buildGuard = readFileSync(new URL('../client-app/build/direct-auto-update.mjs', import.meta.url), 'utf8');
const installer = readFileSync(new URL('../client-app/build/installer.nsh', import.meta.url), 'utf8');
const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));

const updateStart = bootstrap.indexOf('async function checkUpdatesAndContinue()');
const updateEnd = bootstrap.indexOf('\ncreateSplash();', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'startup updater flow must exist');
const updater = bootstrap.slice(updateStart, updateEnd);

assert.match(updater, /const manifest = await fetchManifest\(\)/, 'must check latest version during startup');
assert.match(updater, /const installerPath = await downloadInstaller\(manifest\)/, 'newer version must download automatically');
assert.match(
  updater,
  /await launchDownloadedInstaller\(\{ silent: true \}\)/,
  'verified update must begin installation automatically',
);
assert.match(
  bootstrap,
  /const args = silent \? \['\/S'\] : \[\]/,
  'automatic path must use NSIS silent install mode',
);
assert.match(
  bootstrap,
  /verifyInstallerOnDisk\(installerPath, manifest\)/,
  'installer must be re-verified immediately before installation',
);
assert.match(
  bootstrap,
  /child\.once\('spawn'[\s\S]{0,1400}app\.quit\(\)/,
  'old userFLOW must close only after the installer process starts',
);
assert.match(
  bootstrap,
  /url === 'userflex-update:\/\/install'[\s\S]{0,180}launchDownloadedInstaller\(\)/,
  'interactive install button must remain as fallback if Windows blocks silent launch',
);
assert.doesNotMatch(
  startup,
  /enableAutomaticInstallerLaunch|__userflowAutoInstallerObserver|autoStarted/,
  'automatic installation must be owned by bootstrap, not synthetic renderer clicks',
);
assert.match(
  buildGuard,
  /Updater must automatically launch the verified installer/,
  'build must guard the automatic-install contract',
);

assert.match(
  installer,
  /!macro customInstall[\s\S]*IfSilent 0 \+2[\s\S]*ExecShell "open" "\$INSTDIR\\userFLEX Client\.exe" "--userflow-updated"/,
  'silent update must relaunch the newly installed userFLOW automatically',
);
assert.equal(
  pkg.build?.nsis?.deleteAppDataOnUninstall,
  false,
  'updates must preserve AppData, including auth.json and persistent browser profiles',
);
assert.match(
  main,
  /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]{0,260}await loadAuth\(\);[\s\S]{0,160}createMainWindow\(\);/,
  'restarted userFLOW must reload the saved client authentication before showing the main window',
);
assert.match(
  renderer,
  /window\.userflex\.bootstrap\(\)[\s\S]{0,220}result\?\.authenticated[\s\S]{0,180}renderClient\(\)/,
  'a valid saved session must reopen the authenticated client view without asking for credentials',
);
assert.doesNotMatch(
  startup,
  /supabase\.co|DIRECT_UPDATE_BASE|SUPABASE_/i,
  'startup/update code must not retain a legacy Supabase path',
);

console.log('Automatic updater installation flow: OK');
