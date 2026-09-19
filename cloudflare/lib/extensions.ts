import { unzipSync, strFromU8 } from 'fflate';
import type { AdminIdentity } from './auth';
import type { ClientIdentity } from './auth';
import { Env, HttpError, audit, bodyJson, json, optional, sb, sha, text, token, uuid } from './core';
import { touchProfileClients } from './client-revalidation';

const BUCKET = 'userflex-extension-packages';
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 1500;
const BLOCKED_PERMISSIONS = new Set(['management', 'debugger', 'nativeMessaging', 'proxy']);
const VALIDATION_TTL_MS = 10 * 60 * 1000;

type ExtensionRow = {
  id: string;
  name: string;
  description: string | null;
  version: string;
  manifest: any;
  permissions: string[];
  package_path: string;
  package_sha256: string;
  package_size: number;
  scope: 'global' | 'selective';
  enabled: boolean;
  validation_status: 'package_valid' | 'runtime_valid' | 'error' | 'incompatible';
  validation_message: string | null;
  runtime_validated_at: string | null;
  created_at: string;
  updated_at: string;
};

function storageConfig(env: Env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'SUPABASE_CONFIG_MISSING', 'Supabase no está configurado.');
  return { url, key };
}

async function storageRequest(env: Env, objectPath: string, init: RequestInit = {}) {
  const { url, key } = storageConfig(env);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('apikey', key);
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 240);
    console.error('Extension storage', response.status, objectPath, detail);
    throw new HttpError(502, 'EXTENSION_STORAGE_ERROR', 'No se pudo completar la operación con el paquete de la extensión.');
  }
  return response;
}

async function uploadPackage(env: Env, objectPath: string, bytes: Uint8Array) {
  await storageRequest(env, objectPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/zip',
      'x-upsert': 'true',
      'cache-control': 'private, max-age=31536000, immutable',
    },
    body: bytes,
  });
}

async function removePackage(env: Env, objectPath: string) {
  if (!objectPath) return;
  await storageRequest(env, objectPath, { method: 'DELETE' }).catch(() => null);
}

async function readPackage(env: Env, objectPath: string) {
  const response = await storageRequest(env, objectPath, { method: 'GET' });
  return new Uint8Array(await response.arrayBuffer());
}

async function digestBytes(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function cleanZipName(value: string) {
  const name = String(value || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[A-Za-z]:\//.test(name) || name.includes('\0')) {
    throw new HttpError(400, 'EXTENSION_ZIP_PATH_INVALID', 'El ZIP contiene una ruta no válida.');
  }
  const parts = name.split('/');
  if (parts.some((part) => part === '..')) {
    throw new HttpError(400, 'EXTENSION_ZIP_PATH_INVALID', 'El ZIP contiene rutas inseguras.');
  }
  return name.replace(/^\.\//, '');
}

function referencedFiles(manifest: any) {
  const files: string[] = [];
  if (typeof manifest?.background?.service_worker === 'string') files.push(manifest.background.service_worker);
  if (Array.isArray(manifest?.background?.scripts)) files.push(...manifest.background.scripts.filter((v: unknown) => typeof v === 'string'));
  if (typeof manifest?.action?.default_popup === 'string') files.push(manifest.action.default_popup);
  if (typeof manifest?.browser_action?.default_popup === 'string') files.push(manifest.browser_action.default_popup);
  if (typeof manifest?.page_action?.default_popup === 'string') files.push(manifest.page_action.default_popup);
  for (const script of Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : []) {
    if (Array.isArray(script?.js)) files.push(...script.js.filter((v: unknown) => typeof v === 'string'));
    if (Array.isArray(script?.css)) files.push(...script.css.filter((v: unknown) => typeof v === 'string'));
  }
  const icons = manifest?.icons && typeof manifest.icons === 'object' ? Object.values(manifest.icons) : [];
  files.push(...icons.filter((v: unknown) => typeof v === 'string') as string[]);
  return [...new Set(files.map((value) => cleanZipName(value)))];
}

function inspectExtensionZip(bytes: Uint8Array) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new HttpError(413, 'EXTENSION_PACKAGE_SIZE', 'El paquete ZIP debe pesar entre 1 byte y 20 MB.');
  }

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new HttpError(400, 'EXTENSION_ZIP_INVALID', 'El archivo no es un ZIP válido.');
  }

  const names = Object.keys(archive).map(cleanZipName);
  if (names.length < 1 || names.length > MAX_FILES) {
    throw new HttpError(400, 'EXTENSION_FILE_COUNT', 'El paquete contiene demasiados archivos.');
  }
  let unpacked = 0;
  for (const name of names) {
    unpacked += archive[name]?.byteLength || 0;
    if (unpacked > MAX_UNPACKED_BYTES) {
      throw new HttpError(413, 'EXTENSION_UNPACKED_SIZE', 'La extensión descomprimida supera el límite permitido.');
    }
  }

  const manifestBytes = archive['manifest.json'];
  if (!manifestBytes) {
    const nestedManifest = names.find((name) => /\/manifest\.json$/i.test(name));
    if (nestedManifest) {
      throw new HttpError(400, 'EXTENSION_MANIFEST_NOT_ROOT', 'manifest.json debe estar en la raíz del ZIP. Comprime el contenido de la carpeta, no la carpeta completa.');
    }
    throw new HttpError(400, 'EXTENSION_MANIFEST_MISSING', 'El ZIP no contiene manifest.json.');
  }

  let manifest: any;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new HttpError(400, 'EXTENSION_MANIFEST_INVALID', 'manifest.json no contiene JSON válido.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new HttpError(400, 'EXTENSION_MANIFEST_INVALID', 'manifest.json no es válido.');
  }

  const manifestVersion = Number(manifest.manifest_version);
  const extensionVersion = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const manifestName = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  if (!manifestName || manifestName.length > 200) throw new HttpError(400, 'EXTENSION_NAME_INVALID', 'El manifest no contiene un nombre válido.');
  if (!/^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(extensionVersion)) {
    throw new HttpError(400, 'EXTENSION_VERSION_INVALID', 'La versión de manifest.json no es válida.');
  }

  for (const file of referencedFiles(manifest)) {
    if (!archive[file]) {
      throw new HttpError(400, 'EXTENSION_FILE_MISSING', `El manifest hace referencia a un archivo que no existe: ${file}`);
    }
  }

  const permissions = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ].filter((value: unknown) => typeof value === 'string').map(String).slice(0, 200);
  const blocked = permissions.filter((permission) => BLOCKED_PERMISSIONS.has(permission));

  if (manifestVersion !== 3) {
    return {
      manifest,
      version: extensionVersion,
      permissions,
      status: 'incompatible' as const,
      message: `Manifest V${manifestVersion || '?'} no está habilitado para extensiones administradas. Usa Manifest V3.`,
    };
  }
  if (blocked.length) {
    return {
      manifest,
      version: extensionVersion,
      permissions,
      status: 'incompatible' as const,
      message: `Permisos bloqueados por seguridad: ${blocked.join(', ')}.`,
    };
  }

  return {
    manifest,
    version: extensionVersion,
    permissions,
    status: 'package_valid' as const,
    message: 'Paquete, manifest y archivos referenciados validados. Falta la prueba real en userFLOW.',
  };
}

function extensionPublic(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    version: row.version,
    manifest: row.manifest || {},
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    package_sha256: row.package_sha256,
    package_size: Number(row.package_size || 0),
    scope: row.scope,
    enabled: row.enabled === true,
    validation_status: row.validation_status,
    validation_message: row.validation_message || null,
    runtime_validated_at: row.runtime_validated_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function extensionRow(env: Env, extensionId: string): Promise<ExtensionRow> {
  const rows = await sb(env, `userflex_extensions?select=*&id=eq.${extensionId}&limit=1`);
  if (!rows?.[0]) throw new HttpError(404, 'EXTENSION_NOT_FOUND', 'La extensión no existe.');
  return rows[0] as ExtensionRow;
}

function scopeValue(value: unknown): 'global' | 'selective' {
  return value === 'global' ? 'global' : 'selective';
}

async function touchExtensionProfiles(env: Env, extensionId: string) {
  const memberships = await sb(env, `userflex_profile_extensions?select=profile_id&extension_id=eq.${extensionId}`);
  await Promise.all((memberships || []).map((row: any) => touchProfileClients(env, row.profile_id).catch(() => null)));
  const extension = await extensionRow(env, extensionId).catch(() => null);
  if (extension?.scope === 'global') {
    const profiles = await sb(env, 'userflex_profiles?select=id');
    await Promise.all((profiles || []).map((row: any) => touchProfileClients(env, row.id).catch(() => null)));
  }
}

async function parseUpload(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_PACKAGE_BYTES + 1024 * 1024) throw new HttpError(413, 'EXTENSION_PACKAGE_SIZE');
  const form = await request.formData();
  const packageFile = form.get('package');
  if (!(packageFile instanceof File)) throw new HttpError(400, 'EXTENSION_PACKAGE_REQUIRED', 'Selecciona un archivo ZIP.');
  const bytes = new Uint8Array(await packageFile.arrayBuffer());
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new HttpError(413, 'EXTENSION_PACKAGE_SIZE', 'El paquete no puede superar 20 MB.');
  return {
    form,
    bytes,
    inspection: inspectExtensionZip(bytes),
    sha256: await digestBytes(bytes),
  };
}

export async function adminExtensionRoutes(request: Request, env: Env, admin: AdminIdentity): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/extensions' && method === 'GET') {
    const rows = await sb(env, 'userflex_extensions?select=*&order=name.asc');
    return json((rows || []).map(extensionPublic));
  }

  if (path === '/api/profile-extension-memberships' && method === 'GET') {
    return json(await sb(env, 'userflex_profile_extensions?select=profile_id,extension_id,created_at&order=created_at.asc'));
  }

  if (path === '/api/extensions' && method === 'POST') {
    const { form, bytes, inspection, sha256 } = await parseUpload(request);
    const id = crypto.randomUUID();
    const name = text(form.get('name'), 'name', 120);
    const description = optional(form.get('description'), 1000);
    const scope = scopeValue(form.get('scope'));
    const objectPath = `${id}/${sha256}.zip`;
    await uploadPackage(env, objectPath, bytes);

    try {
      const rows = await sb(env, 'userflex_extensions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          id,
          name,
          description,
          version: inspection.version,
          manifest: inspection.manifest,
          permissions: inspection.permissions,
          package_path: objectPath,
          package_sha256: sha256,
          package_size: bytes.byteLength,
          scope,
          enabled: false,
          validation_status: inspection.status,
          validation_message: inspection.message,
        }),
      });
      await audit(env, request, 'admin', admin.userId, 'extension.create', 'extension', id, {
        version: inspection.version,
        scope,
        status: inspection.status,
      });
      return json(extensionPublic(rows[0]), 201);
    } catch (error) {
      await removePackage(env, objectPath);
      throw error;
    }
  }

  const packageMatch = path.match(/^\/api\/extensions\/([0-9a-f-]{36})\/package$/i);
  if (packageMatch && method === 'POST') {
    const extensionId = uuid(packageMatch[1], 'extensionId');
    const current = await extensionRow(env, extensionId);
    const { bytes, inspection, sha256 } = await parseUpload(request);
    const objectPath = `${extensionId}/${sha256}.zip`;
    await uploadPackage(env, objectPath, bytes);
    try {
      const rows = await sb(env, `userflex_extensions?id=eq.${extensionId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          version: inspection.version,
          manifest: inspection.manifest,
          permissions: inspection.permissions,
          package_path: objectPath,
          package_sha256: sha256,
          package_size: bytes.byteLength,
          enabled: false,
          validation_status: inspection.status,
          validation_message: inspection.message,
          runtime_validated_at: null,
          updated_at: new Date().toISOString(),
        }),
      });
      if (current.package_path !== objectPath) await removePackage(env, current.package_path);
      await touchExtensionProfiles(env, extensionId);
      await audit(env, request, 'admin', admin.userId, 'extension.package.update', 'extension', extensionId, {
        version: inspection.version,
        status: inspection.status,
      });
      return json(extensionPublic(rows[0]));
    } catch (error) {
      if (current.package_path !== objectPath) await removePackage(env, objectPath);
      throw error;
    }
  }

  const profilesMatch = path.match(/^\/api\/extensions\/([0-9a-f-]{36})\/profiles$/i);
  if (profilesMatch && method === 'POST') {
    const extensionId = uuid(profilesMatch[1], 'extensionId');
    const extension = await extensionRow(env, extensionId);
    const body = await bodyJson(request, 64 * 1024);
    const values = Array.isArray(body.profileIds) ? body.profileIds : [];
    const profileIds = [...new Set(values.map((value: unknown) => uuid(value, 'profileId')))].slice(0, 500);
    await sb(env, `userflex_profile_extensions?extension_id=eq.${extensionId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (extension.scope === 'selective' && profileIds.length) {
      await sb(env, 'userflex_profile_extensions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(profileIds.map((profileId) => ({ profile_id: profileId, extension_id: extensionId }))),
      });
    }
    await Promise.all(profileIds.map((profileId) => touchProfileClients(env, profileId).catch(() => null)));
    await audit(env, request, 'admin', admin.userId, 'extension.profiles.set', 'extension', extensionId, {
      profileCount: extension.scope === 'global' ? 'all' : profileIds.length,
    });
    return json({ ok: true, extension_id: extensionId, profile_ids: extension.scope === 'global' ? [] : profileIds });
  }

  const profileSetMatch = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/extensions$/i);
  if (profileSetMatch && method === 'POST') {
    const profileId = uuid(profileSetMatch[1], 'profileId');
    const body = await bodyJson(request, 64 * 1024);
    const values = Array.isArray(body.extensionIds) ? body.extensionIds : [];
    const extensionIds = [...new Set(values.map((value: unknown) => uuid(value, 'extensionId')))].slice(0, 500);
    if (extensionIds.length) {
      const rows = await sb(env, `userflex_extensions?select=id,scope,enabled,validation_status&id=in.(${extensionIds.join(',')})`);
      const eligible = new Set((rows || [])
        .filter((row: any) => row.scope === 'selective' && row.validation_status === 'runtime_valid')
        .map((row: any) => row.id));
      const invalid = extensionIds.filter((id) => !eligible.has(id));
      if (invalid.length) throw new HttpError(409, 'EXTENSION_NOT_SELECTABLE', 'Una o más extensiones todavía no están verificadas en userFLOW.');
    }
    await sb(env, `userflex_profile_extensions?profile_id=eq.${profileId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (extensionIds.length) {
      await sb(env, 'userflex_profile_extensions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(extensionIds.map((extensionId) => ({ profile_id: profileId, extension_id: extensionId }))),
      });
    }
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.extensions.set', 'profile', profileId, { extensionIds });
    return json({ ok: true, profile_id: profileId, extension_ids: extensionIds });
  }

  const testMatch = path.match(/^\/api\/extensions\/([0-9a-f-]{36})\/runtime-test$/i);
  if (testMatch && method === 'POST') {
    const extensionId = uuid(testMatch[1], 'extensionId');
    const extension = await extensionRow(env, extensionId);
    if (extension.validation_status === 'incompatible') {
      throw new HttpError(409, 'EXTENSION_INCOMPATIBLE', extension.validation_message || 'La extensión es incompatible.');
    }
    const rawToken = token(32);
    const tokenHash = await sha(rawToken);
    const jobId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + VALIDATION_TTL_MS).toISOString();
    await sb(env, 'userflex_extension_validation_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: jobId,
        extension_id: extensionId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      }),
    });
    const origin = new URL(request.url).origin;
    await audit(env, request, 'admin', admin.userId, 'extension.runtime_test.start', 'extension', extensionId, { jobId });
    return json({
      ok: true,
      job_id: jobId,
      expires_at: expiresAt,
      launch_url: `userflow-client://extension-test?endpoint=${encodeURIComponent(origin)}&token=${encodeURIComponent(rawToken)}`,
    });
  }

  const testStatusMatch = path.match(/^\/api\/extension-tests\/([0-9a-f-]{36})$/i);
  if (testStatusMatch && method === 'GET') {
    const jobId = uuid(testStatusMatch[1], 'jobId');
    const rows = await sb(env, `userflex_extension_validation_jobs?select=id,extension_id,status,result,error,expires_at,created_at,updated_at&id=eq.${jobId}&limit=1`);
    if (!rows?.[0]) throw new HttpError(404, 'EXTENSION_TEST_NOT_FOUND');
    return json({ ok: true, job: rows[0] });
  }

  const extensionMatch = path.match(/^\/api\/extensions\/([0-9a-f-]{36})$/i);
  if (extensionMatch && method === 'PATCH') {
    const extensionId = uuid(extensionMatch[1], 'extensionId');
    const current = await extensionRow(env, extensionId);
    const body = await bodyJson(request);
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 120);
    if (body.description !== undefined) patch.description = optional(body.description, 1000);
    if (body.scope !== undefined) patch.scope = scopeValue(body.scope);
    if (body.enabled !== undefined) {
      if (Boolean(body.enabled) && current.validation_status !== 'runtime_valid') {
        throw new HttpError(409, 'EXTENSION_NOT_RUNTIME_VALIDATED', 'Prueba primero la extensión en userFLOW antes de activarla.');
      }
      patch.enabled = Boolean(body.enabled);
    }
    const rows = await sb(env, `userflex_extensions?id=eq.${extensionId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (patch.scope === 'global') {
      await sb(env, `userflex_profile_extensions?extension_id=eq.${extensionId}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
    await touchExtensionProfiles(env, extensionId);
    await audit(env, request, 'admin', admin.userId, 'extension.update', 'extension', extensionId, {
      scope: rows[0].scope,
      enabled: rows[0].enabled,
    });
    return json(extensionPublic(rows[0]));
  }

  if (extensionMatch && method === 'DELETE') {
    const extensionId = uuid(extensionMatch[1], 'extensionId');
    const current = await extensionRow(env, extensionId);
    await touchExtensionProfiles(env, extensionId);
    await sb(env, `userflex_extensions?id=eq.${extensionId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await removePackage(env, current.package_path);
    await audit(env, request, 'admin', admin.userId, 'extension.delete', 'extension', extensionId);
    return json({ ok: true });
  }

  return null;
}

async function testJobByToken(env: Env, rawToken: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) throw new HttpError(400, 'EXTENSION_TEST_TOKEN_INVALID');
  const tokenHash = await sha(rawToken);
  const rows = await sb(env, `userflex_extension_validation_jobs?select=*&token_hash=eq.${tokenHash}&limit=1`);
  const job = rows?.[0];
  if (!job) throw new HttpError(404, 'EXTENSION_TEST_NOT_FOUND');
  if (new Date(job.expires_at).getTime() <= Date.now()) {
    await sb(env, `userflex_extension_validation_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() }),
    }).catch(() => null);
    throw new HttpError(410, 'EXTENSION_TEST_EXPIRED', 'La prueba de extensión expiró.');
  }
  return job;
}

export async function publicExtensionTestRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/extension-test/bootstrap' && method === 'POST') {
    const body = await bodyJson(request);
    const rawToken = text(body.token, 'token', 100);
    const job = await testJobByToken(env, rawToken);
    const extension = await extensionRow(env, job.extension_id);
    await sb(env, `userflex_extension_validation_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'running', updated_at: new Date().toISOString() }),
    });
    return json({
      ok: true,
      job: { id: job.id, extension_id: extension.id, expires_at: job.expires_at },
      extension: {
        id: extension.id,
        name: extension.name,
        manifestName: typeof extension.manifest?.name === 'string' ? extension.manifest.name : extension.name,
        version: extension.version,
        sha256: extension.package_sha256,
        size: Number(extension.package_size),
        packageUrl: `/api/extension-test/package?token=${encodeURIComponent(rawToken)}`,
      },
    });
  }

  if (path === '/api/extension-test/package' && method === 'GET') {
    const rawToken = String(url.searchParams.get('token') || '');
    const job = await testJobByToken(env, rawToken);
    const extension = await extensionRow(env, job.extension_id);
    const bytes = await readPackage(env, extension.package_path);
    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(bytes, { status: 200, headers });
  }

  if (path === '/api/extension-test/report' && method === 'POST') {
    const body = await bodyJson(request, 128 * 1024);
    const rawToken = text(body.token, 'token', 100);
    const job = await testJobByToken(env, rawToken);
    const extension = await extensionRow(env, job.extension_id);
    const result = body.result && typeof body.result === 'object' ? body.result : {};
    const passed = result.ok === true && result.loaded === true;
    const error = passed ? null : optional(body.error || result.error || 'Chrome no confirmó la carga de la extensión.', 1000);
    const now = new Date().toISOString();
    await sb(env, `userflex_extension_validation_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: passed ? 'pass' : 'fail',
        result,
        error,
        updated_at: now,
      }),
    });
    await sb(env, `userflex_extensions?id=eq.${extension.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        validation_status: passed ? 'runtime_valid' : 'error',
        validation_message: passed
          ? 'Chrome/userFLOW confirmó que la extensión se carga correctamente.'
          : error,
        runtime_validated_at: passed ? now : null,
        enabled: passed ? extension.enabled === true : false,
        updated_at: now,
      }),
    });
    await touchExtensionProfiles(env, extension.id);
    return json({ ok: true, passed });
  }

  return null;
}

export async function managedExtensionsForProfiles(env: Env, profileIds: string[]) {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const result = new Map<string, any[]>();
  ids.forEach((id) => result.set(id, []));
  if (!ids.length) return result;

  const [globalRows, memberships] = await Promise.all([
    sb(env, "userflex_extensions?select=id,name,version,package_sha256,package_size&scope=eq.global&enabled=eq.true&validation_status=eq.runtime_valid&order=name.asc"),
    sb(env, `userflex_profile_extensions?select=profile_id,extension_id&profile_id=in.(${ids.join(',')})`),
  ]);
  const selectiveIds = [...new Set((memberships || []).map((row: any) => row.extension_id))];
  const selectiveRows = selectiveIds.length
    ? await sb(env, `userflex_extensions?select=id,name,version,package_sha256,package_size&id=in.(${selectiveIds.join(',')})&enabled=eq.true&validation_status=eq.runtime_valid&order=name.asc`)
    : [];
  const selectiveMap = new Map((selectiveRows || []).map((row: any) => [row.id, row]));

  for (const profileId of ids) {
    const list = [
      ...(globalRows || []),
      ...(memberships || [])
        .filter((row: any) => row.profile_id === profileId)
        .map((row: any) => selectiveMap.get(row.extension_id))
        .filter(Boolean),
    ];
    const seen = new Set<string>();
    result.set(profileId, list.filter((row: any) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }).map((row: any) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      sha256: row.package_sha256,
      size: Number(row.package_size || 0),
      packageUrl: `/api/client/extensions/${row.id}/package?sha=${row.package_sha256}`,
    })));
  }
  return result;
}

export async function clientExtensionPackage(request: Request, env: Env, identity: ClientIdentity, extensionIdRaw: string): Promise<Response> {
  const extensionId = uuid(extensionIdRaw, 'extensionId');
  const extension = await extensionRow(env, extensionId);
  if (!extension.enabled || extension.validation_status !== 'runtime_valid') {
    throw new HttpError(404, 'EXTENSION_NOT_AVAILABLE');
  }

  const memberships = await sb(env, `userflex_plan_profiles?select=profile_id&plan_id=eq.${identity.plan.id}`);
  const profileIds = (memberships || []).map((row: any) => row.profile_id);
  if (!profileIds.length) throw new HttpError(403, 'EXTENSION_NOT_AUTHORIZED');

  let authorized = extension.scope === 'global';
  if (!authorized) {
    const rows = await sb(
      env,
      `userflex_profile_extensions?select=profile_id&extension_id=eq.${extensionId}&profile_id=in.(${profileIds.join(',')})&limit=1`,
    );
    authorized = Boolean(rows?.[0]);
  }
  if (!authorized) throw new HttpError(403, 'EXTENSION_NOT_AUTHORIZED');

  const bytes = await readPackage(env, extension.package_path);
  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, max-age=3600',
    'ETag': `"${extension.package_sha256}"`,
    'X-Userflex-Extension-SHA256': extension.package_sha256,
    'X-Content-Type-Options': 'nosniff',
  });
  return new Response(bytes, { status: 200, headers });
}
