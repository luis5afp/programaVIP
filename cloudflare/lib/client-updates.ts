import { Env, HttpError, type R2BucketLike } from './core';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PART_RE = /^part-\d{3}\.bin$/;
const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const LATEST_MEMORY_TTL_MS = 30_000;
const KEEP_RELEASE_VERSIONS = 3;

let latestMemoryCache: { body: Uint8Array; contentType: string; expiresAt: number } | null = null;

function releaseBucket(env: Env): R2BucketLike {
  if (!env.CLIENT_RELEASES) throw new HttpError(503, 'UPDATE_STORAGE_UNAVAILABLE', 'Cloudflare R2 no está configurado.');
  return env.CLIENT_RELEASES;
}

function responseHeaders(contentType: string, cacheControl: string, length: number, source: string) {
  const headers = new Headers();
  headers.set('Content-Type', contentType || 'application/octet-stream');
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Length', String(length));
  headers.set('X-Userflex-Update-Source', source);
  return headers;
}

function validateLatestManifest(body: Uint8Array) {
  let value: any;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
  }

  const version = String(value?.version || '').trim();
  const size = Number(value?.size || 0);
  const sha256 = String(value?.sha256 || '').trim().toLowerCase();
  const chunks = Array.isArray(value?.chunks) ? value.chunks : [];

  if (!VERSION_RE.test(version)) throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
  if (!Number.isSafeInteger(size) || size < 1 || size > 300 * 1024 * 1024) {
    throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
  if (chunks.length < 1 || chunks.length > 64) throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');

  let total = 0;
  for (const item of chunks) {
    const name = String(item?.name || '');
    const chunkSize = Number(item?.size || 0);
    if (!name.startsWith(`versions/${version}/`) || !/^versions\/[0-9A-Za-z.-]+\/part-\d{3}\.bin$/.test(name)) {
      throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_BYTES) {
      throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
    }
    total += chunkSize;
  }
  if (total !== size) throw new HttpError(502, 'UPDATE_MANIFEST_INVALID');
}

function latestCacheKey(request: Request) {
  const url = new URL(request.url);
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

async function cacheMatch(request: Request): Promise<Response | null> {
  try {
    const cache = (globalThis as any).caches?.default;
    if (!cache?.match) return null;
    return (await cache.match(latestCacheKey(request))) || null;
  } catch {
    return null;
  }
}

async function cachePut(request: Request, response: Response) {
  try {
    const cache = (globalThis as any).caches?.default;
    if (!cache?.put) return;
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=30');
    await cache.put(latestCacheKey(request), new Response(response.body, {
      status: response.status,
      headers,
    }));
  } catch {
    // Cache API is an optimization only.
  }
}

async function latestManifest(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  if (latestMemoryCache && latestMemoryCache.expiresAt > now) {
    return new Response(latestMemoryCache.body.slice(), {
      status: 200,
      headers: responseHeaders(
        latestMemoryCache.contentType,
        'no-store, max-age=0',
        latestMemoryCache.body.byteLength,
        'r2-memory-cache',
      ),
    });
  }

  const cached = await cacheMatch(request);
  if (cached) {
    const body = new Uint8Array(await cached.arrayBuffer());
    validateLatestManifest(body);
    latestMemoryCache = {
      body,
      contentType: cached.headers.get('Content-Type') || 'application/json',
      expiresAt: now + LATEST_MEMORY_TTL_MS,
    };
    return new Response(body.slice(), {
      status: 200,
      headers: responseHeaders('application/json', 'no-store, max-age=0', body.byteLength, 'r2-edge-cache'),
    });
  }

  const object = await releaseBucket(env).get('latest.json');
  if (!object) throw new HttpError(404, 'UPDATE_OBJECT_UNAVAILABLE');
  const body = new Uint8Array(await object.arrayBuffer());
  validateLatestManifest(body);
  const contentType = object.httpMetadata?.contentType || 'application/json';
  latestMemoryCache = { body, contentType, expiresAt: now + LATEST_MEMORY_TTL_MS };

  const response = new Response(body.slice(), {
    status: 200,
    headers: responseHeaders(contentType, 'no-store, max-age=0', body.byteLength, 'cloudflare-r2'),
  });
  await cachePut(request, response.clone());
  return response;
}

async function chunkResponse(env: Env, objectPath: string): Promise<Response> {
  const object = await releaseBucket(env).get(objectPath);
  if (!object) throw new HttpError(404, 'UPDATE_OBJECT_UNAVAILABLE');
  if (object.size < 1 || object.size > MAX_CHUNK_BYTES) throw new HttpError(502, 'UPDATE_CHUNK_TOO_LARGE');

  const body = new Uint8Array(await object.arrayBuffer());
  if (body.byteLength !== object.size || body.byteLength > MAX_CHUNK_BYTES) {
    throw new HttpError(502, 'UPDATE_CHUNK_LENGTH_MISMATCH');
  }

  return new Response(body, {
    status: 200,
    headers: responseHeaders(
      object.httpMetadata?.contentType || 'application/octet-stream',
      'public, max-age=31536000, immutable',
      body.byteLength,
      'cloudflare-r2',
    ),
  });
}

function versionParts(value: string) {
  return value.split('-')[0].split('.').map((part) => Number(part) || 0);
}

function compareVersionsDesc(a: string, b: string) {
  const av = versionParts(a);
  const bv = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    if ((av[index] || 0) !== (bv[index] || 0)) return (bv[index] || 0) - (av[index] || 0);
  }
  return b.localeCompare(a);
}

export async function pruneClientReleaseStorage(env: Env, keep = KEEP_RELEASE_VERSIONS) {
  const bucket = releaseBucket(env);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'versions/', limit: 1000, cursor });
    keys.push(...page.objects.map((item) => item.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const versions = Array.from(new Set(
    keys
      .map((key) => key.split('/')[1] || '')
      .filter((version) => VERSION_RE.test(version)),
  )).sort(compareVersionsDesc);

  const removeVersions = versions.slice(Math.max(keep, 1));
  const removeKeys = keys.filter((key) => removeVersions.includes(key.split('/')[1] || ''));

  for (let index = 0; index < removeKeys.length; index += 1000) {
    await bucket.delete(removeKeys.slice(index, index + 1000));
  }

  return {
    storage: 'cloudflare-r2',
    keepVersions: versions.slice(0, Math.max(keep, 1)),
    removedVersions: removeVersions,
    removedObjects: removeKeys.length,
  };
}

export async function publicClientUpdateRoutes(request: Request, env: Env): Promise<Response | null> {
  if (request.method.toUpperCase() !== 'GET') return null;
  const url = new URL(request.url);

  if (url.pathname === '/api/client-update/latest') {
    return latestManifest(request, env);
  }

  const chunk = url.pathname.match(/^\/api\/client-update\/chunks\/([^/]+)\/(part-\d{3}\.bin)$/);
  if (chunk) {
    const version = decodeURIComponent(chunk[1]);
    const part = chunk[2];
    if (!VERSION_RE.test(version) || !PART_RE.test(part)) throw new HttpError(400, 'UPDATE_PATH_INVALID');
    return chunkResponse(env, `versions/${version}/${part}`);
  }

  return null;
}
