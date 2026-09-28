import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cloudflare/lib/extensions.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ExtensionsView.tsx', import.meta.url), 'utf8');

assert.match(
  worker,
  /const STRIPPED_PERMISSIONS = new Set\(\['management'\]\)/,
  'management must be removed from managed extension manifests instead of marking the package incompatible',
);
assert.doesNotMatch(
  worker,
  /BLOCKED_PERMISSIONS = new Set\(\[[^\]]*management/,
  'management must no longer be part of the hard-blocked permission set',
);
assert.match(
  worker,
  /manifest\[key\] = manifest\[key\]\.filter[\s\S]{0,420}STRIPPED_PERMISSIONS\.has\(value\)/,
  'extension inspection must physically remove management from manifest permissions',
);
assert.match(
  worker,
  /normalizedArchive\['manifest\.json'\] = strToU8[\s\S]{0,260}zipSync\(normalizedArchive/,
  'the sanitized manifest must be written back into the ZIP that userFLOW installs',
);
assert.match(
  worker,
  /repairLegacyManagementPermission[\s\S]{0,1800}validation_status: inspection\.status/,
  'already uploaded incompatible management-only extensions must be repaired in place',
);
assert.match(
  worker,
  /Promise\.all\(\(rows \|\| \[\]\)\.map\(\(row: ExtensionRow\) => repairLegacyManagementPermission/,
  'listing extensions must repair legacy management-only records without requiring re-upload',
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
assert.match(
  view,
  /no se eliminan desde este panel/,
  'the UI must explain that extensions are disabled instead of deleted',
);

console.log('Managed extension permission policy: OK');
