import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');
const buildGuard = readFileSync(new URL('../client-app/build/direct-auto-update.mjs', import.meta.url), 'utf8');

const updateStart = bootstrap.indexOf('async function checkUpdatesAndContinue()');
const updateEnd = bootstrap.indexOf('\ncreateSplash();', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, 'startup updater flow must exist');
const updater = bootstrap.slice(updateStart, updateEnd);

assert.match(
  updater,
  /const manifest = await fetchManifest\(\)/,
  'userFLOW must check the latest manifest during startup',
);
assert.match(
  updater,
  /const installerPath = await downloadInstaller\(manifest\)/,
  'a newer version must download automatically',
);
assert.match(
  updater,
  /phase:\s*'ready-install'/,
  'downloaded updates must wait in the ready-install state',
);
assert.doesNotMatch(
  updater,
  /await launchDownloadedInstaller\(\)/,
  'the installer must not be launched automatically after download',
);

assert.match(
  bootstrap,
  /url === 'userflex-update:\/\/install'[\s\S]{0,180}launchDownloadedInstaller\(\)/,
  'the visible install action must remain wired to the installer launcher',
);
assert.match(
  bootstrap,
  /verifyInstallerOnDisk\(installerPath, manifest\)/,
  'manual installation must re-verify the downloaded installer before launching it',
);
assert.match(
  bootstrap,
  /child\.once\('spawn'[\s\S]{0,900}app\.quit\(\)/,
  'userFLOW must close only after the Windows installer has successfully opened',
);

assert.doesNotMatch(
  startup,
  /enableAutomaticInstallerLaunch|__userflowAutoInstallerObserver|autoStarted/,
  'startup must not inject an automatic installer click',
);
assert.match(
  buildGuard,
  /Updater must not launch the installer automatically after download/,
  'the build must guard against reintroducing automatic installation',
);

console.log('Manual updater installation flow: OK');
