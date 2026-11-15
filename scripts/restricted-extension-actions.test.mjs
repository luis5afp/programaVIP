import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  suppressManagedExtensionToolbarAction,
  prepareRestrictedManagedExtensions,
} from '../client-app/browser-engine/restricted-extension-actions.js';

const sourceManifest = {
  manifest_version: 3,
  name: 'Toolspoint-Extension',
  version: '3.0.18',
  permissions: ['management', 'tabs', 'storage'],
  host_permissions: ['https://*/*'],
  action: { default_popup: 'popup.html', default_title: 'Toolspoint' },
  commands: { _execute_action: { suggested_key: { default: 'Ctrl+Shift+Y' } }, jump: { suggested_key: { default: 'Alt+Y' } } },
  background: { service_worker: 'src/bg.js' },
  content_scripts: [{ matches: ['https://*/*'], js: ['src/content.js'] }],
};
const strip = suppressManagedExtensionToolbarAction(sourceManifest);
assert.equal(strip.removed, true);
assert.equal(Object.hasOwn(strip.manifest,'action'), false);
assert.equal(Object.hasOwn(strip.manifest.commands,'_execute_action'), false);
assert.ok(strip.manifest.commands.jump, 'unrelated extension commands remain');
assert.deepEqual(strip.manifest.background,sourceManifest.background);
assert.deepEqual(strip.manifest.content_scripts,sourceManifest.content_scripts);
assert.deepEqual(strip.manifest.permissions,sourceManifest.permissions);
assert.ok(sourceManifest.action.default_popup, 'must never mutate approved source');
assert.deepEqual(suppressManagedExtensionToolbarAction({
  manifest_version: 3, name: 'ex1', version: '1.8',
}).manifest,{manifest_version: 3, name: 'ex1', version: '1.8'});
assert.equal(Object.hasOwn(suppressManagedExtensionToolbarAction({
  manifest_version: 2, name:'Legacy', browser_action: {default_popup:'popup.html'},
}).manifest,'browser_action'),false);

const root=await mkdtemp(path.join(tmpdir(),'userflow-extensions-restricted-'));
try {
  const source=path.join(root,'cached-approved-extension');
  await mkdir(path.join(source,'src'),{recursive:true});
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(sourceManifest),'utf8');
  await writeFile(path.join(source,'src','bg.js'),'chrome.runtime.onInstalled.addListener(()=>{});','utf8');
  await writeFile(path.join(source,'src','content.js'),'void 1;','utf8');
  await writeFile(path.join(source,'popup.html'),'<h1>Toolspoint popup</h1>','utf8');
  const item={id:'extension-1',name:'toolspoint',version:'3.0.18',sha256:'a'.repeat(64),dir:source};
  const outputA=await prepareRestrictedManagedExtensions([item],path.join(root,'client-A','profile-1'));
  const outputB=await prepareRestrictedManagedExtensions([item],path.join(root,'client-B','profile-1'));
  assert.equal(outputA.length,1);
  assert.equal(outputA[0].manifestName,'Toolspoint-Extension');
  assert.equal(outputA[0].toolbarActionRemoved,true);
  assert.notEqual(outputA[0].dir,outputB[0].dir,'isolate client/profile manifests');
  const outputManifest=JSON.parse(await readFile(path.join(outputA[0].dir,'manifest.json'),'utf8'));
  assert.equal(Object.hasOwn(outputManifest,'action'),false);
  assert.deepEqual(outputManifest.content_scripts,sourceManifest.content_scripts);
  assert.equal(await readFile(path.join(outputA[0].dir,'src','bg.js'),'utf8'),
    await readFile(path.join(source,'src','bg.js'),'utf8'));
  assert.equal(await readFile(path.join(outputA[0].dir,'src','content.js'),'utf8'),
    await readFile(path.join(source,'src','content.js'),'utf8'));
  assert.equal(JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8')).action.default_popup,
    'popup.html','approved source must never be modified');
  assert.equal(JSON.parse(await readFile(path.join(outputB[0].dir,'manifest.json'),'utf8')).action,
    undefined,'all restricted customers get action-free manifest');
  await assert.rejects(
    ()=>prepareRestrictedManagedExtensions([{...item,version:'99'}],path.join(root,'bad')),
    /no coinciden/);
} finally {
  await rm(root,{recursive:true,force:true});
}
const engine=await readFile(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url),'utf8');
assert.match(engine,/extensionsUiAccess === 'restricted' && !ephemeral/);
assert.match(engine,/managedExtensionNames: scopedManaged/);
assert.match(engine,/item\?\.manifestName/);
assert.match(engine,/const managedExtensionDirs = scopedManaged/);
console.log('Restricted extension toolbar actions and profile isolation: OK');
