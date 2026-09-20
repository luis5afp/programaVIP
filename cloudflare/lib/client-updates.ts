import { Env, HttpError } from './core';

const RELEASE_BUCKET = 'userflex-client-releases';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PART_RE = /^part-\d{3}\.bin$/;
const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 3_500;
const UPSTREAM_ATTEMPTS = 3;
const LATEST_MEMORY_TTL_MS = 30_000;

let latestMemoryCache: { body: Uint8Array; contentType: string; expiresAt: number } | null = null;

function storageUrl(env: Env, objectPath: string): string {
  if (!env.SUPABASE_URL) throw new HttpError(503, 'UPDATE_STORAGE_UNAVAILABLE');
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${RELEASE_BUCKET}/${objectPath}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUpstreamWithRetry(env: Env, objectPath: string): Promise<Response> {
  let lastStatus = 0;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(storageUrl(env, objectPath), {
        method: 'GET',
        headers: { Accept: '*/*', 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      lastStatus = response.status;
      if (response.ok && response.body) return response;
      if (response.status === 404) {
        throw new HttpError(404, 'UPDATE_OBJECT_UNAVAILABLE');
      }
      lastError = new Error(`UPDATE_UPSTREAM_HTTP_${response.status}`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < UPSTREAM_ATTEMPTS) await sleep(80 * attempt);
  }

  console.error(
    'Updater upstream failed',
    objectPath,
    lastStatus || 'network',
    lastError instanceof Error ? lastError.message : String(lastError || ''),
  );
  throw new HttpError(502, 'UPDATE_OBJECT_UNAVAILABLE');
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
    const cached = new Response(response.body, {
      status: response.status,
      headers,
    });
    await cache.put(latestCacheKey(request), cached);
  } catch {
    // Cache API is an optimization only. Updater delivery must keep working.
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
        'memory-cache',
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
      headers: responseHeaders(
        latestMemoryCache.contentType,
        'no-store, max-age=0',
        body.byteLength,
        'edge-cache',
      ),
    });
  }

  const upstream = await fetchUpstreamWithRetry(env, 'latest.json');
  const body = new Uint8Array(await upstream.arrayBuffer());
  validateLatestManifest(body);
  const contentType = upstream.headers.get('Content-Type') || 'application/json';
  latestMemoryCache = {
    body,
    contentType,
    expiresAt: now + LATEST_MEMORY_TTL_MS,
  };

  const clientResponse = new Response(body.slice(), {
    status: 200,
    headers: responseHeaders(contentType, 'no-store, max-age=0', body.byteLength, 'supabase'),
  });
  await cachePut(request, clientResponse.clone());
  return clientResponse;
}

async function chunkResponse(env: Env, objectPath: string): Promise<Response> {
  const upstream = await fetchUpstreamWithRetry(env, objectPath);
  const advertised = Number(upstream.headers.get('Content-Length') || 0);
  if (advertised > MAX_CHUNK_BYTES) throw new HttpError(502, 'UPDATE_CHUNK_TOO_LARGE');

  // Buffer one updater chunk before replying. Legacy clients do not retry a
  // partially streamed chunk; returning only after the upstream object is
  // complete prevents a transient Supabase stream interruption from silently
  // sending old userFLOW versions into their fail-open login path.
  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength < 1 || body.byteLength > MAX_CHUNK_BYTES) {
    throw new HttpError(502, 'UPDATE_CHUNK_INVALID');
  }
  if (advertised && advertised !== body.byteLength) {
    throw new HttpError(502, 'UPDATE_CHUNK_LENGTH_MISMATCH');
  }

  return new Response(body, {
    status: 200,
    headers: responseHeaders(
      upstream.headers.get('Content-Type') || 'application/octet-stream',
      'public, max-age=31536000, immutable',
      body.byteLength,
      'supabase-buffered',
    ),
  });
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
