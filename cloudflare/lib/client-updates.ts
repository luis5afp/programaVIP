import { Env, HttpError } from './core';

const RELEASE_BUCKET = 'userflex-client-releases';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PART_RE = /^part-\d{3}\.bin$/;

function storageUrl(env: Env, objectPath: string): string {
  if (!env.SUPABASE_URL) throw new HttpError(503, 'UPDATE_STORAGE_UNAVAILABLE');
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${RELEASE_BUCKET}/${objectPath}`;
}

async function proxyObject(env: Env, objectPath: string, cacheControl: string): Promise<Response> {
  const upstream = await fetch(storageUrl(env, objectPath), {
    method: 'GET',
    headers: { Accept: '*/*', 'Cache-Control': 'no-cache' },
  });

  if (!upstream.ok || !upstream.body) {
    throw new HttpError(upstream.status === 404 ? 404 : 502, 'UPDATE_OBJECT_UNAVAILABLE');
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  const length = upstream.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);

  return new Response(upstream.body, { status: 200, headers });
}

export async function publicClientUpdateRoutes(request: Request, env: Env): Promise<Response | null> {
  if (request.method.toUpperCase() !== 'GET') return null;
  const url = new URL(request.url);

  if (url.pathname === '/api/client-update/latest') {
    return proxyObject(env, 'latest.json', 'no-store, max-age=0');
  }

  const chunk = url.pathname.match(/^\/api\/client-update\/chunks\/([^/]+)\/(part-\d{3}\.bin)$/);
  if (chunk) {
    const version = decodeURIComponent(chunk[1]);
    const part = chunk[2];
    if (!VERSION_RE.test(version) || !PART_RE.test(part)) throw new HttpError(400, 'UPDATE_PATH_INVALID');
    return proxyObject(env, `versions/${version}/${part}`, 'public, max-age=31536000, immutable');
  }

  return null;
}
