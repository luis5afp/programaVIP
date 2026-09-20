import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../client-app/startup.js', import.meta.url), 'utf8');
const buildGuard = readFileSync(new URL('../client-app/build/direct-auto-update.mjs', import.meta.url), 'utf8');

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

console.log('Automatic updater installation flow: OK');
