import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cloudflare/lib/extensions.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ExtensionsView.tsx', import.meta.url), 'utf8');
const bundled = readFileSync(new URL('../cloudflare/lib/builtin-extensions.ts', import.meta.url), 'utf8');

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
  worker,
  /repairRetriableRuntimeFailure[\s\S]{0,1400}validation_status: 'package_valid'/,
  'an old runtime-test failure must be repaired into a retriable package-valid state',
);
assert.match(
  worker,
  /validation_status: passed \? 'runtime_valid' : 'package_valid'/,
  'a failed runtime test must stay retriable instead of permanently marking the extension as a load error',
);
assert.match(
  worker,
  /Vuelve a probar con userFLOW 0\.3\.76 o superior/,
  'legacy failures must tell the administrator to retest with the fixed client',
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
  worker,
  /ensureBundledExtensionsInstalled\(request, env, admin\)/,
  'opening the extensions Admin view must install the bundled userFLOW packages server-side',
);
assert.match(
  worker,
  /scope: 'global',[\s\S]{0,120}enabled: true,[\s\S]{0,160}validation_status: 'runtime_valid'/,
  'bundled ex1/ex2 must be globally active and runtime-valid on first installation',
);
assert.match(
  worker,
  /needsFirstActivation[\s\S]{0,1800}extension\.builtin\.activate/,
  'legacy bundled rows left package-valid and disabled must be activated once',
);
assert.match(
  worker,
  /if \(!needsFirstActivation\) continue/,
  'after first activation the server must respect a later manual deactivation',
);
assert.match(
  worker,
  /const nextEnabled = wasAlreadyValidated \? current\.enabled === true : true/,
  'bundled updates must preserve an administrator deactivation after validation',
);
assert.match(bundled, /name: 'ex1'/);
assert.match(bundled, /name: 'ex2'/);
assert.match(bundled, /No depende de kaizzen\.org/);
assert.doesNotMatch(
  bundled,
  /https:\/\/www\.kaizzen\.org\/s\//,
  'bundled extensions must not call the third-party KAIZZEN backend',
);
assert.doesNotMatch(
  bundled,
  /api\/users\/history/,
  'bundled ex1 must not upload browsing history to a third party',
);

console.log('Managed extension permission policy: OK');
