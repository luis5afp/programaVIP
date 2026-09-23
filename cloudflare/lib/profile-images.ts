import { AdminIdentity } from './auth';
import { Env, HttpError, audit, json, sb } from './core';

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

  if (!env.PROFILE_IMAGES) {
    throw new HttpError(503, 'PROFILE_IMAGE_STORAGE_MISSING', 'El almacenamiento de imágenes no está configurado.');
  }

  const objectPath = `profiles/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const bytes = await value.arrayBuffer();
  try {
    await env.PROFILE_IMAGES.put(objectPath, bytes, {
      httpMetadata: {
        contentType: mime,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Cloudflare R2 profile image upload failed', error instanceof Error ? error.message : String(error));
    throw new HttpError(502, 'PROFILE_IMAGE_UPLOAD_FAILED', 'No se pudo guardar la imagen.');
  }

  const publicUrl = `${new URL(request.url).origin}/api/profile-image-files/${encodeStoragePath(objectPath)}`;
  await audit(env, request, 'admin', admin.userId, 'profile.image.upload', 'profile_image', objectPath, {
    mime,
    bytes: value.size,
  });

  return json({ ok: true, url: publicUrl, path: objectPath, mime, size: value.size }, 201);
}


function validR2ObjectPath(value: string) {
  return /^profiles\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i.test(value);
}

export async function serveProfileImageObject(
  request: Request,
  env: Env,
  objectPath: string,
): Promise<Response> {
  if (!validR2ObjectPath(objectPath)) throw new HttpError(404, 'PROFILE_IMAGE_NOT_FOUND');
  if (!env.PROFILE_IMAGES) {
    throw new HttpError(503, 'PROFILE_IMAGE_STORAGE_MISSING', 'El almacenamiento de imágenes no está configurado.');
  }

  const object = await env.PROFILE_IMAGES.get(objectPath);
  if (!object) throw new HttpError(404, 'PROFILE_IMAGE_NOT_FOUND');

  const contentType = String(object.httpMetadata?.contentType || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new HttpError(502, 'PROFILE_IMAGE_CONTENT_INVALID', 'La imagen guardada no tiene un formato válido.');
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', object.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');

  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}


export async function serveProfileImage(
  _request: Request,
  env: Env,
  profileId: string,
): Promise<Response> {
  const rows = await sb(
    env,
    `userflex_profiles?select=id,image_url&id=eq.${profileId}&enabled=eq.true&limit=1`,
  );
  const profile = rows?.[0];
  if (!profile?.image_url) throw new HttpError(404, 'PROFILE_IMAGE_NOT_FOUND');

  let target: URL;
  try {
    target = new URL(String(profile.image_url));
  } catch {
    throw new HttpError(502, 'PROFILE_IMAGE_URL_INVALID', 'La URL de la imagen del perfil no es válida.');
  }
  if (target.protocol !== 'https:') {
    throw new HttpError(502, 'PROFILE_IMAGE_URL_INVALID', 'La imagen del perfil debe usar HTTPS.');
  }
  return Response.redirect(target.toString(), 302);
}
