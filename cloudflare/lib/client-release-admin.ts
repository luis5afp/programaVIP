import type { AdminIdentity } from './auth';
import { Env, HttpError, audit, bodyJson, json } from './core';
import { MIN_USERFLOW_VERSION, versionAtLeast } from './release-compat';

const RELEASE_BUCKET = 'userflex-client-releases';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type ReleaseManifest = {
  version: string;
  size: number;
  sha256: string;
  chunks: Array<{ name: string; size: number }>;
  publishedAt: string | null;
};

function storageBase(env: Env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'UPDATE_STORAGE_UNAVAILABLE', 'El almacenamiento de actualizaciones no está configurado.');
  return { url, key };
}

function publicObjectUrl(env: Env, objectPath: string) {
  const { url } = storageBase(env);
  return `${url}/storage/v1/object/public/${RELEASE_BUCKET}/${objectPath}`;
}

function validateManifest(value: any, expectedVersion?: string): ReleaseManifest {
  const version = typeof value?.version === 'string' ? value.version.trim() : '';
  const size = Number(value?.size || 0);
  const sha256 = typeof value?.sha256 === 'string' ? value.sha256.toLowerCase() : '';
  const chunks = Array.isArray(value?.chunks) ? value.chunks : [];
  if (!VERSION_RE.test(version) || (expectedVersion && version !== expectedVersion)) {
    throw new HttpError(409, 'RELEASE_MANIFEST_INVALID', 'El manifiesto de la versión no coincide.');
  }
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-f]{64}$/.test(sha256) || chunks.length < 1) {
    throw new HttpError(409, 'RELEASE_MANIFEST_INVALID', 'El manifiesto de actualización está incompleto.');
  }
  const normalizedChunks = chunks.map((chunk: any) => ({
    name: typeof chunk?.name === 'string' ? chunk.name : '',
    size: Number(chunk?.size || 0),
  }));
  if (normalizedChunks.some((chunk: { name: string; size: number }) =>
    !chunk.name.startsWith(`versions/${version}/part-`)
    || !Number.isSafeInteger(chunk.size)
    || chunk.size <= 0
  )) {
    throw new HttpError(409, 'RELEASE_MANIFEST_INVALID', 'El manifiesto contiene partes inválidas.');
  }
  return {
    version,
    size,
    sha256,
    chunks: normalizedChunks,
    publishedAt: typeof value?.publishedAt === 'string' ? value.publishedAt : null,
  };
}

async function fetchJsonObject(env: Env, objectPath: string, expectedVersion?: string) {
  const response = await fetch(`${publicObjectUrl(env, objectPath)}?ts=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new HttpError(502, 'UPDATE_STORAGE_READ_FAILED', 'No se pudo leer el manifiesto de actualizaciones.');
  }
  let parsed: any;
  try {
    parsed = await response.json();
  } catch {
    throw new HttpError(409, 'RELEASE_MANIFEST_INVALID', 'El manifiesto de actualización no es JSON válido.');
  }
  return validateManifest(parsed, expectedVersion);
}

async function listVersionFolders(env: Env): Promise<string[]> {
  const { url, key } = storageBase(env);
  const response = await fetch(`${url}/storage/v1/object/list/${RELEASE_BUCKET}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix: 'versions',
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'desc' },
    }),
  });
  if (!response.ok) throw new HttpError(502, 'UPDATE_STORAGE_LIST_FAILED', 'No se pudieron listar las versiones publicadas.');
  const rows: any[] = await response.json();
  return Array.from(new Set(
    rows
      .map((row) => String(row?.name || '').trim())
      .filter((name) => VERSION_RE.test(name)),
  ));
}

function versionParts(value: string) {
  const main = value.split('-')[0].split('.').map((part) => Number(part));
  return [main[0] || 0, main[1] || 0, main[2] || 0];
}

function compareVersions(a: string, b: string) {
  const av = versionParts(a);
  const bv = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return bv[index] - av[index];
  }
  return b.localeCompare(a);
}

async function releaseStatus(env: Env) {
  const active = await fetchJsonObject(env, 'latest.json');
  if (!active) throw new HttpError(404, 'CLIENT_RELEASE_NOT_FOUND', 'No hay una versión activa del cliente.');

  let folderVersions: string[] = [];
  try {
    folderVersions = await listVersionFolders(env);
  } catch {
    folderVersions = [];
  }

  const candidates = Array.from(new Set([active.version, ...folderVersions]))
    .filter((version) => VERSION_RE.test(version))
    .sort(compareVersions);
  const manifests = await Promise.all(candidates.slice(0, 30).map(async (version) => {
    if (version === active.version) return active;
    return fetchJsonObject(env, `versions/${version}/manifest.json`, version).catch(() => null);
  }));
  const available = (manifests.filter(Boolean) as ReleaseManifest[])
    .filter((manifest) => versionAtLeast(manifest.version, MIN_USERFLOW_VERSION));

  return {
    active,
    minimumCompatibleVersion: MIN_USERFLOW_VERSION,
    activeCompatible: versionAtLeast(active.version, MIN_USERFLOW_VERSION),
    available: available.map((manifest) => ({
      ...manifest,
      downloadUrl: `https://github.com/luis5afp/programaVIP/releases/download/client-v${manifest.version}/userFLOW-${manifest.version}-Setup.exe`,
      active: manifest.version === active.version,
    })),
    downloadUrl: `https://github.com/luis5afp/programaVIP/releases/download/client-v${active.version}/userFLOW-${active.version}-Setup.exe`,
  };
}

async function uploadLatest(env: Env, manifest: ReleaseManifest) {
  const { url, key } = storageBase(env);
  const response = await fetch(`${url}/storage/v1/object/${RELEASE_BUCKET}/latest.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'x-upsert': 'true',
      'cache-control': 'max-age=0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(manifest),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    console.error('Release activation upload failed', response.status, detail);
    throw new HttpError(502, 'CLIENT_RELEASE_ACTIVATION_FAILED', 'No se pudo activar la versión seleccionada.');
  }
}

async function verifyChunks(env: Env, manifest: ReleaseManifest) {
  const checks = await Promise.all(manifest.chunks.map(async (chunk) => {
    const response = await fetch(publicObjectUrl(env, chunk.name), { method: 'HEAD' });
    return response.ok;
  }));
  if (checks.some((ok) => !ok)) {
    throw new HttpError(409, 'CLIENT_RELEASE_INCOMPLETE', 'La versión seleccionada no tiene todas sus partes publicadas.');
  }
}

export async function adminClientReleaseRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/system/client-release' && method === 'GET') {
    return json({ ok: true, ...(await releaseStatus(env)) });
  }

  if (path === '/api/system/client-release/activate' && method === 'POST') {
    if (admin.role !== 'owner') {
      throw new HttpError(403, 'OWNER_REQUIRED', 'Solo el propietario puede cambiar la versión activa del cliente.');
    }
    const body = await bodyJson(request);
    const version = typeof body.version === 'string' ? body.version.trim() : '';
    if (!VERSION_RE.test(version)) throw new HttpError(400, 'INVALID_VERSION', 'La versión no es válida.');
    if (!versionAtLeast(version, MIN_USERFLOW_VERSION)) {
      throw new HttpError(
        409,
        'CLIENT_RELEASE_INCOMPATIBLE',
        `El servidor requiere userFLOW v${MIN_USERFLOW_VERSION} o superior.`,
      );
    }

    const current = await fetchJsonObject(env, 'latest.json');
    if (current?.version === version) {
      return json({ ok: true, unchanged: true, ...(await releaseStatus(env)) });
    }

    const manifest = await fetchJsonObject(env, `versions/${version}/manifest.json`, version);
    if (!manifest) throw new HttpError(404, 'CLIENT_RELEASE_NOT_FOUND', 'La versión seleccionada no está publicada.');
    await verifyChunks(env, manifest);
    await uploadLatest(env, manifest);

    const verified = await fetchJsonObject(env, 'latest.json', version);
    if (!verified) throw new HttpError(502, 'CLIENT_RELEASE_ACTIVATION_FAILED');

    await audit(env, request, 'admin', admin.userId, 'client.release.activate', 'client_release', version, {
      previousVersion: current?.version || null,
      version,
      size: manifest.size,
      chunks: manifest.chunks.length,
    });

    return json({ ok: true, changed: true, ...(await releaseStatus(env)) });
  }

  return null;
}
