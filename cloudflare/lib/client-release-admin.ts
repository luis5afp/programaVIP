import type { AdminIdentity } from './auth';
import { Env, HttpError, audit, bodyJson, json, type R2BucketLike } from './core';
import { MIN_USERFLOW_VERSION, versionAtLeast } from './release-compat';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type ReleaseManifest = {
  version: string;
  size: number;
  sha256: string;
  chunks: Array<{ name: string; size: number }>;
  publishedAt: string | null;
};

function releaseBucket(env: Env): R2BucketLike {
  if (!env.CLIENT_RELEASES) {
    throw new HttpError(503, 'UPDATE_STORAGE_UNAVAILABLE', 'Cloudflare R2 no está configurado.');
  }
  return env.CLIENT_RELEASES;
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
  const object = await releaseBucket(env).get(objectPath);
  if (!object) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(await object.text());
  } catch {
    throw new HttpError(409, 'RELEASE_MANIFEST_INVALID', 'El manifiesto de actualización no es JSON válido.');
  }
  return validateManifest(parsed, expectedVersion);
}

async function listVersionFolders(env: Env): Promise<string[]> {
  const bucket = releaseBucket(env);
  const versions = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'versions/', limit: 1000, cursor });
    for (const object of page.objects) {
      const version = object.key.split('/')[1] || '';
      if (VERSION_RE.test(version)) versions.add(version);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return Array.from(versions);
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

  const folderVersions = await listVersionFolders(env).catch(() => []);
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
    storage: 'cloudflare-r2',
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
  await releaseBucket(env).put('latest.json', JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store, max-age=0' },
  });
}

async function verifyChunks(env: Env, manifest: ReleaseManifest) {
  const bucket = releaseBucket(env);
  const checks = await Promise.all(manifest.chunks.map((chunk) => bucket.head(chunk.name)));
  if (checks.some((object) => !object)) {
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
      storage: 'cloudflare-r2',
    });

    return json({ ok: true, changed: true, ...(await releaseStatus(env)) });
  }

  return null;
}
