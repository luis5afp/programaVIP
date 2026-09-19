import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_SESSION_MANAGER_VERSION,
  MIN_USERFLOW_VERSION,
  compareVersions,
  versionAtLeast,
} from '../cloudflare/lib/release-compat.ts';

assert.equal(compareVersions('0.3.15', '0.3.15'), 0);
assert.equal(compareVersions('0.3.16', '0.3.15'), 1);
assert.equal(compareVersions('0.4.0', '0.3.99'), 1);
assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
assert.equal(compareVersions('0.3.14', '0.3.15'), -1);
assert.equal(compareVersions('bad', '0.3.15'), null);
assert.equal(versionAtLeast('0.3.15', MIN_USERFLOW_VERSION), true);
assert.equal(versionAtLeast('0.3.14', MIN_USERFLOW_VERSION), false);
assert.equal(versionAtLeast('', MIN_USERFLOW_VERSION), false);

const clientPackage = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));
const sessionPackage = JSON.parse(readFileSync(new URL('../session-manager/package.json', import.meta.url), 'utf8'));

assert.equal(clientPackage.version, MIN_USERFLOW_VERSION);
assert.equal(sessionPackage.version, MIN_SESSION_MANAGER_VERSION);
assert.equal(clientPackage.version, sessionPackage.version);

console.log(`Release compatibility: userFLOW ${MIN_USERFLOW_VERSION} / Session Manager ${MIN_SESSION_MANAGER_VERSION} OK`);
