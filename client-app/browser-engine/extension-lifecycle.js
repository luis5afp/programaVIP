import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function requireExtensionManifests(directories) {
  for (const dir of directories) {
    try {
      if (typeof dir !== 'string' || !dir) throw Error('invalid path');
      const manifest = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
      if (typeof manifest.name !== 'string' || !manifest.name.trim() ||
          typeof manifest.version !== 'string' || !manifest.version.trim() ||
          ![2,3].includes(manifest.manifest_version)) throw Error('invalid manifest');
    } catch {
      throw Object.assign(new Error('No se pudo leer un manifiesto de extensión obligatorio. Actualiza userFLOW o solicita al administrador revisar la extensión.'),{code:'EXTENSION_MANIFEST_UNAVAILABLE',launchStage:'prepare-extensions'});
    }
  }
  return directories;
}

export async function removeTemporaryExtensionFiles({isUnused,directories,remove=(dir)=>fsp.rm(dir,{recursive:true,force:true}),pause=()=>new Promise(resolve=>setTimeout(resolve,350))}) {
  // Two consecutive confirmations reduce the chance of a child process
  // starting during Chromium shutdown. Unknown status always retains files.
  try {
    if (await isUnused() !== true) return false;
    await pause();
    if (await isUnused() !== true) return false;
    for (const dir of directories) await remove(dir);
    return true;
  } catch { return false; }
}
