import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_SESSION_MANAGER_VERSION,
  MIN_USERFLOW_VERSION,
  compareVersions,
  versionAtLeast,
} from '../cloudflare/lib/release-compat.ts';

assert.equal(compareVersions('0.3.37', '0.3.37'), 0);
assert.equal(compareVersions('0.3.37', '0.3.36'), 1);
assert.equal(compareVersions('0.3.36', '0.3.37'), -1);
assert.equal(compareVersions('0.4.0', '0.3.99'), 1);
assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
assert.equal(compareVersions('bad', '0.3.22'), null);

assert.equal(versionAtLeast('0.3.36', MIN_USERFLOW_VERSION), true);
assert.equal(versionAtLeast('0.3.35', MIN_USERFLOW_VERSION), false);
assert.equal(versionAtLeast('0.3.37', MIN_SESSION_MANAGER_VERSION), true);
assert.equal(versionAtLeast('0.3.36', MIN_SESSION_MANAGER_VERSION), false);

const clientPackage = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));
const sessionPackage = JSON.parse(readFileSync(new URL('../session-manager/package.json', import.meta.url), 'utf8'));

assert.equal(clientPackage.version, '0.3.36');
assert.equal(sessionPackage.version, '0.3.37');
assert.equal(MIN_USERFLOW_VERSION, '0.3.36');
assert.equal(MIN_SESSION_MANAGER_VERSION, '0.3.37');

console.log(`Independent compatibility: userFLOW ${clientPackage.version} (min ${MIN_USERFLOW_VERSION}) / Session Manager ${sessionPackage.version} (min ${MIN_SESSION_MANAGER_VERSION}) OK`);
