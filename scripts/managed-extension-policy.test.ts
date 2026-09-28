import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cloudflare/lib/extensions.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ExtensionsView.tsx', import.meta.url), 'utf8');

assert.match(
  worker,
  /const WARNING_PERMISSIONS = new Set\(\['management'\]\)/,
  'management must be accepted as a warning-only permission',
);
assert.doesNotMatch(
  worker,
  /BLOCKED_PERMISSIONS = new Set\(\[[^\]]*management/,
  'management must not be hard blocked',
);
assert.match(
  worker,
  /warnings = \[\.\.\.new Set\(permissions\.filter\(\(permission\) => WARNING_PERMISSIONS\.has\(permission\)\)\)\]/,
  'inspection must detect management as a warning permission',
);
assert.match(
  worker,
  /status: 'package_valid' as const,[\s\S]{0,260}Advertencia: permiso sensible permitido/,
  'management-only packages must remain valid and continue to runtime testing',
);
assert.doesNotMatch(
  worker,
  /zipSync\(normalizedArchive|STRIPPED_PERMISSIONS|removedPermissions/,
  'warning-only permissions must not be removed or rewrite the uploaded ZIP',
);
assert.match(
  worker,
  /repairLegacyManagementWarning[\s\S]{0,1100}validation_status: 'package_valid'/,
  'legacy management-only incompatible records must be upgraded to warning-only package_valid',
);
assert.match(
  view,
  /\{item\.enabled \? 'Desactivar' : 'Activar'\}/,
  'the Admin must have an explicit deactivate/activate control',
);
assert.doesNotMatch(
  view,
  />\s*Eliminar\s*<\/button>/,
  'managed extensions must not expose destructive deletion in the normal Admin UI',
);

console.log('Managed extension permission policy: OK');
