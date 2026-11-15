import fs from 'node:fs/promises';
import path from 'node:path';

// Browser extensions own their action popups. Chrome/Edge do not expose a
// supported API for another extension to cancel someone else's action click.
// Give restricted clients a *profile-specific* unpacked copy without toolbar
// actions, while keeping background/content scripts, host permissions and
// other capabilities intact. Never mutate the approved downloaded ZIP cache
// (which full-access clients and validation tests still use).
function safeSegment(value) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90);
  if (!clean) throw new Error('Identificador de extensión administrada inválido.');
  return clean;
}

export function suppressManagedExtensionToolbarAction(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('El manifiesto de la extensión administrada no es válido.');
  }
  const restricted = structuredClone(manifest);
  let removed = false;
  for (const key of ['action', 'browser_action', 'page_action']) {
    if (Object.hasOwn(restricted, key)) {
      delete restricted[key];
      removed = true;
    }
  }
  // _execute_action is only legal when there is an action to execute.
  if (restricted.commands && typeof restricted.commands === 'object'
      && Object.hasOwn(restricted.commands, '_execute_action')) {
    delete restricted.commands._execute_action;
    if (!Object.keys(restricted.commands).length) delete restricted.commands;
    removed = true;
  }
  return { manifest: restricted, removed };
}

export async function prepareRestrictedManagedExtensions(items, destinationRoot) {
  if (!Array.isArray(items) || !destinationRoot) {
    throw new Error('No se pudo preparar la copia de extensiones del perfil restringido.');
  }
  const prepared = [];
  await fs.mkdir(destinationRoot, { recursive: true });

  for (const item of items) {
    const sourceDir = String(item?.dir || '').trim();
    const sourceManifestPath = path.join(sourceDir, 'manifest.json');
    const raw = await fs.readFile(sourceManifestPath, 'utf8');
    const sourceManifest = JSON.parse(raw);
    const name = String(sourceManifest.name || '').trim();
    if (!name || String(sourceManifest.version || '') !== String(item?.version || '')) {
      throw new Error('Los datos de una extensión no coinciden con el paquete autorizado.');
    }

    const result = suppressManagedExtensionToolbarAction(sourceManifest);
    const destination = path.join(destinationRoot, safeSegment(item.id));
    // This path belongs to a single userFLOW client/profile, so its manifest
    // can be safely adapted without affecting any other running client.
    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(sourceDir, destination, { recursive: true, force: true });
    await fs.writeFile(path.join(destination, 'manifest.json'),
      JSON.stringify(result.manifest, null, 2) + '\n', 'utf8');

    prepared.push({
      ...item,
      dir: destination,
      manifestName: name,
      toolbarActionRemoved: result.removed,
    });
  }
  return prepared;
}
