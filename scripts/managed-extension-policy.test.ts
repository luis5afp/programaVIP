import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cloudflare/lib/extensions.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ExtensionsView.tsx', import.meta.url), 'utf8');
const bundled = readFileSync(new URL('../cloudflare/lib/builtin-extensions.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');

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
assert.match(
  worker,
  /async function ensurePackageObject[\s\S]{0,800}extensionBucket\(env\)\.head\(objectPath\)[\s\S]{0,800}uploadPackage\(env, objectPath, bytes\)/,
  'bundled packages must be restored automatically when their R2 object is missing',
);
assert.match(
  worker,
  /if \(current && samePackage\) \{\s*await ensurePackageObject\(env, objectPath, inspection\.packageBytes\)/,
  'opening the Admin extensions view must repair a missing bundled R2 object even when metadata already matches',
);
assert.match(
  worker,
  /async function repairBundledPackageForClient[\s\S]{0,2200}package_path: objectPath[\s\S]{0,400}package_sha256: sha256/,
  'client downloads must repair bundled package storage and stale package metadata',
);
assert.match(
  worker,
  /extension = await repairBundledPackageForClient\(env, extension\)[\s\S]{0,500}EXTENSION_VERSION_CHANGED/,
  'the client package route must self-heal bundled storage before comparing the requested SHA',
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
assert.match(
  bundled,
  /mtime: new Date\('2026-01-01T00:00:00\.000Z'\)/,
  'bundled extension ZIPs must use a fixed mtime so their SHA-256 stays stable across requests',
);
assert.match(
  client,
  /payload\?\.code \|\| 'EXTENSION_DOWNLOAD_FAILED'/,
  'binary extension downloads must preserve structured server error codes',
);
assert.match(
  client,
  /async function prepareManagedExtensionsForProfile[\s\S]{0,900}error\?\.code !== 'EXTENSION_VERSION_CHANGED'[\s\S]{0,900}const freshCatalog = await catalog\(\)/,
  'userFLOW must refresh extension metadata and retry once when the package SHA changes during launch',
);
assert.match(
  client,
  /profile\.extensions = Array\.isArray\(freshProfile\.extensions\) \? freshProfile\.extensions : \[\]/,
  'the retry must replace stale extension metadata on the active profile',
);
assert.match(
  client,
  /try \{\s*const managedExtensions = await prepareManagedExtensionsForProfile\(profile\)/,
  'extension preparation must run inside the launch cleanup guard',
);

console.log('Managed extension permission policy: OK');
