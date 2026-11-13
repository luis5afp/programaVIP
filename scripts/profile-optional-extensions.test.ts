import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterGlobalExtensionsForProfile,
  isProfileOptionalGlobalExtension,
  optionalGlobalAvailableToAnyProfile,
  persistedProfileExtensionIds,
} from '../cloudflare/lib/profile-extension-selection.ts';

const ex1 = { id: 'ex1-id', name: 'ex1', scope: 'global' };
const ex2 = { id: 'ex2-id', name: 'ex2', scope: 'global' };
const mandatory = { id: 'other-id', name: 'other', scope: 'global' };
assert.equal(isProfileOptionalGlobalExtension(ex1), true);
assert.equal(isProfileOptionalGlobalExtension(ex2), true);
assert.equal(isProfileOptionalGlobalExtension(mandatory), false);
assert.equal(isProfileOptionalGlobalExtension({ ...ex1, scope: 'selective' }), false);

// Before any admin action, both global bundled extensions remain enabled.
assert.deepEqual(filterGlobalExtensionsForProfile([ex1, ex2, mandatory], []), [ex1, ex2, mandatory]);
// Disabling EX1 in one profile does not disable EX2 or any other globals.
assert.deepEqual(filterGlobalExtensionsForProfile([ex1, ex2, mandatory], ['ex1-id']), [ex2, mandatory]);
assert.deepEqual(filterGlobalExtensionsForProfile([ex1, ex2, mandatory], ['ex1-id', 'ex2-id']), [mandatory]);

assert.deepEqual(persistedProfileExtensionIds({
  selectedIds: ['selective-id', 'ex2-id'],
  optionalGlobalIds: ['ex1-id', 'ex2-id'],
  previousMembershipIds: [],
  manageOptionalGlobals: true,
}), ['selective-id', 'ex1-id']); // ex1 opt-out persisted, ex2 enabled
assert.deepEqual(persistedProfileExtensionIds({
  selectedIds: ['ex1-id', 'ex2-id'],
  optionalGlobalIds: ['ex1-id', 'ex2-id'],
  previousMembershipIds: ['ex1-id'],
  manageOptionalGlobals: true,
}), []); // re-enabling both removes the opt-out
assert.deepEqual(persistedProfileExtensionIds({
  selectedIds: [],
  optionalGlobalIds: ['ex1-id', 'ex2-id'],
  previousMembershipIds: [],
  manageOptionalGlobals: true,
}), ['ex1-id', 'ex2-id']); // disable both in this profile only
assert.deepEqual(persistedProfileExtensionIds({
  selectedIds: ['selective-id'],
  optionalGlobalIds: ['ex1-id', 'ex2-id'],
  previousMembershipIds: ['ex1-id'],
  manageOptionalGlobals: false,
}), ['selective-id', 'ex1-id']); // old Admin tab cannot reset opt-outs

assert.equal(optionalGlobalAvailableToAnyProfile(['p1', 'p2'], ['p1']), true);
assert.equal(optionalGlobalAvailableToAnyProfile(['p1', 'p2'], ['p1', 'p2']), false);
assert.equal(optionalGlobalAvailableToAnyProfile(['p1'], []), true);

const admin = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const adminApi = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../cloudflare/lib/extensions.ts', import.meta.url), 'utf8');
assert.match(admin, /extensions\.filter\(isOptionalGlobalExtension\)/, 'editor defaults EX1/EX2 on');
assert.match(admin, /disabled=\{!optional \|\| !ready \|\| saving\}/, 'EX1/EX2 are selectable while mandatory globals are locked');
assert.match(admin, /onChange=\{\(\) => toggleExtension\(item\.id\)\}/);
assert.match(adminApi, /manageOptionalGlobals: true/, 'admin must explicitly opt into new selection protocol');
assert.match(server, /persistedProfileExtensionIds\(/, 'server must persist opt-outs');
assert.match(server, /filterGlobalExtensionsForProfile\(/, 'client catalog must honor opt-outs');
assert.match(server, /optionalGlobalAvailableToAnyProfile\(/, 'package authorization must honor opted-out profiles');
assert.match(server, /scope=eq\.selective&enabled=eq\.true/, 'opt-out rows must never be mistaken for selective assignments');
assert.match(server, /if \(!isProfileOptionalGlobalExtension\(\{ scope: nextScope, name: bundled\.name \}\)\)/, 'bundled extension upgrades must preserve profile preferences');

console.log('Per-profile EX1/EX2 selection and Browser Guard compatibility: OK');
