import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {requireExtensionManifests,removeTemporaryExtensionFiles} from '../client-app/browser-engine/extension-lifecycle.js';
const root=await mkdtemp(path.join(os.tmpdir(),'userflow-ext-test-'));
try {
 const dir=path.join(root,'extension');await mkdir(dir);
 assert.throws(()=>requireExtensionManifests([dir]),{code:'EXTENSION_MANIFEST_UNAVAILABLE'});
 await writeFile(path.join(dir,'manifest.json'),'{broken');
 assert.throws(()=>requireExtensionManifests([dir]),{code:'EXTENSION_MANIFEST_UNAVAILABLE'});
 await writeFile(path.join(dir,'manifest.json'),JSON.stringify({name:'Fixture',version:'1.0',manifest_version:3}));
 assert.deepEqual(requireExtensionManifests([dir]),[dir]);
 assert.throws(()=>requireExtensionManifests([dir,path.join(root,'missing')]),{code:'EXTENSION_MANIFEST_UNAVAILABLE'});
 let checks=0;
 assert.equal(await removeTemporaryExtensionFiles({directories:[dir],isUnused:async()=>++checks===1,pause:async()=>{}}),false);
 await access(path.join(dir,'manifest.json'));
 assert.equal(await removeTemporaryExtensionFiles({directories:[dir],isUnused:async()=>{throw Error('unknown');},pause:async()=>{}}),false);
 await access(path.join(dir,'manifest.json'));
 assert.equal(await removeTemporaryExtensionFiles({directories:[dir],isUnused:async()=>true,pause:async()=>{}}),true);
 await assert.rejects(access(dir));
 console.log('Required manifest validation and conservative temporary extension cleanup: OK');
}finally{await rm(root,{recursive:true,force:true});}
