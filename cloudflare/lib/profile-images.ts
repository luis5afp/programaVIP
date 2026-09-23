import { AdminIdentity } from './auth';
import { Env, HttpError, audit, json, sb } from './core';

const PROFILE_IMAGE_BUCKET = 'userflex-profile-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function validMagic(bytes: Uint8Array, mime: string) {
  if (mime === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mime === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/gif') {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

function encodeStoragePath(path: string) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export async function uploadProfileImage(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length && length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, 'PROFILE_IMAGE_TOO_LARGE', 'La imagen no puede superar 5 MB.');
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'PROFILE_IMAGE_MULTIPART_REQUIRED', 'Selecciona o pega un archivo de imagen válido.');
  }

  const form = await request.formData();
  const value = form.get('image');
  if (!(value instanceof File)) {
    throw new HttpError(400, 'PROFILE_IMAGE_MISSING', 'No se recibió ninguna imagen.');
  }

  const mime = value.type.toLowerCase();
  const extension = IMAGE_EXTENSIONS[mime];
  if (!extension) {
    throw new HttpError(415, 'PROFILE_IMAGE_TYPE_INVALID', 'Formato no permitido. Usa JPG, PNG, WebP o GIF.');
  }
  if (value.size < 1 || value.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'PROFILE_IMAGE_TOO_LARGE', 'La imagen no puede superar 5 MB.');
  }

  const signature = new Uint8Array(await value.slice(0, 16).arrayBuffer());
  if (!validMagic(signature, mime)) {
    throw new HttpError(415, 'PROFILE_IMAGE_CONTENT_INVALID', 'El contenido del archivo no coincide con un formato de imagen permitido.');
  }

  const baseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) {
    throw new HttpError(503, 'SUPABASE_CONFIG_MISSING', 'Supabase no está configurado.');
  }

  const objectPath = `profiles/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const encodedPath = encodeStoragePath(objectPath);
  const upload = await fetch(`${baseUrl}/storage/v1/object/${PROFILE_IMAGE_BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': mime,
      'Cache-Control': '31536000',
      'x-upsert': 'false',
    },
    body: value,
  });

  if (!upload.ok) {
    const detail = (await upload.text()).slice(0, 300);
    console.error('Supabase Storage', upload.status, detail);
    throw new HttpError(502, 'PROFILE_IMAGE_UPLOAD_FAILED', 'No se pudo guardar la imagen.');
  }

  const publicUrl = `${baseUrl}/storage/v1/object/public/${PROFILE_IMAGE_BUCKET}/${encodedPath}`;
  await audit(env, request, 'admin', admin.userId, 'profile.image.upload', 'profile_image', objectPath, {
    mime,
    bytes: value.size,
  });

  return json({ ok: true, url: publicUrl, path: objectPath, mime, size: value.size }, 201);
}


function trustedProfileImageUrl(env: Env, rawUrl: unknown) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  if (!value || !base) return null;
  try {
    const target = new URL(value);
    const expected = new URL(base);
    const prefix = `/storage/v1/object/public/${PROFILE_IMAGE_BUCKET}/`;
    if (target.origin !== expected.origin || !target.pathname.startsWith(prefix)) return null;
    return target;
  } catch {
    return null;
  }
}

export async function serveProfileImage(
  request: Request,
  env: Env,
  profileId: string,
): Promise<Response> {
  const rows = await sb(
    env,
    `userflex_profiles?select=id,image_url&id=eq.${profileId}&enabled=eq.true&limit=1`,
  );
  const profile = rows?.[0];
  if (!profile?.image_url) throw new HttpError(404, 'PROFILE_IMAGE_NOT_FOUND');

  const trusted = trustedProfileImageUrl(env, profile.image_url);
  if (!trusted) {
    return Response.redirect(String(profile.image_url), 302);
  }

  const upstream = await fetch(trusted.toString(), {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
    },
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit);

  if (!upstream.ok) {
    throw new HttpError(502, 'PROFILE_IMAGE_FETCH_FAILED', 'No se pudo cargar la imagen del perfil.');
  }

  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new HttpError(502, 'PROFILE_IMAGE_CONTENT_INVALID', 'La imagen del perfil no devolvió un formato válido.');
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  headers.set('X-Content-Type-Options', 'nosniff');
  const etag = upstream.headers.get('etag');
  if (etag) headers.set('ETag', etag);

  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(upstream.body, { status: 200, headers });
}
