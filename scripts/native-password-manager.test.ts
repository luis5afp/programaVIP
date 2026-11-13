import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { disableNativePasswordSavingForManagedProfile } from '../client-app/browser-engine/password-manager-policy.js';
import { bundledExtensions } from '../cloudflare/lib/builtin-extensions.ts';
import { unzipSync } from 'fflate';

const root = await mkdtemp(path.join(os.tmpdir(), 'userflow-password-pref-'));
try {
  const defaultDir = path.join(root, 'Default');
  await mkdir(defaultDir, { recursive: true });
  const preferencesPath = path.join(defaultDir, 'Preferences');
  const loginDataPath = path.join(defaultDir, 'Login Data');
  const cookiesPath = path.join(defaultDir, 'Cookies');
  await writeFile(loginDataPath, 'existing-password-data', 'utf8');
  await writeFile(cookiesPath, 'existing-session-cookies', 'utf8');
  await writeFile(preferencesPath, JSON.stringify({
    extensions: { ui: { dev_mode_warning_snooze_end_time: '999' } },
    profile: { name: 'Managed userFLOW profile' },
    credentials_enable_service: true,
    customized: { untouched: true },
  }), 'utf8');

  await disableNativePasswordSavingForManagedProfile(root);
  const after = JSON.parse(await readFile(preferencesPath, 'utf8'));
  assert.equal(after.credentials_enable_service, false);
  assert.equal(after.credentials_enable_autosignin, false);
  assert.equal(after.credentials_enable_passkeys, false);
  assert.equal(after.profile.password_manager_enabled, false);
  assert.equal(after.profile.name, 'Managed userFLOW profile');
  assert.equal(after.extensions.ui.dev_mode_warning_snooze_end_time, '999');
  assert.equal(after.customized.untouched, true);
  assert.equal(await readFile(loginDataPath, 'utf8'), 'existing-password-data');
  assert.equal(await readFile(cookiesPath, 'utf8'), 'existing-session-cookies');
  const first = await readFile(preferencesPath, 'utf8');
  await disableNativePasswordSavingForManagedProfile(root);
  assert.equal(await readFile(preferencesPath, 'utf8'), first, 'startup hardening should be idempotent');

  await writeFile(preferencesPath, '{bad json', 'utf8');
  await assert.rejects(() => disableNativePasswordSavingForManagedProfile(root));
  assert.equal(await readFile(preferencesPath, 'utf8'), '{bad json', 'invalid browser preferences must not be overwritten');
} finally {
  await rm(root, { recursive: true, force: true });
}

const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
assert.match(engine, /await disableNativePasswordSavingForManagedProfile\(userDataDir\)/);
assert.match(engine, /--disable-password-saving/);
assert.match(engine, /--disable-save-password-bubble/);
const extensions = bundledExtensions();
assert.deepEqual(extensions.map((item) => item.name), ['ex1', 'ex2']);
for (const extension of extensions) {
  const archive = unzipSync(extension.packageBytes);
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
  const background = new TextDecoder().decode(archive['backgroundScript.js']);
  assert.ok(manifest.permissions.includes('privacy'), `${extension.name} must control password-saving prompts`);
  assert.match(background, /chrome\.privacy\?\.services\?\.passwordSavingEnabled/);
  assert.match(background, /value: false, scope: 'regular'/);
  assert.match(background, /chrome:\/\/password-manager/);
  assert.match(background, /edge:\/\/wallet/);
}

console.log('userFLOW managed password-manager restrictions: OK');
