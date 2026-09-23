import { adminLogin, adminLogout, clientLogin, requireAdmin, requireClient } from './lib/auth';
import { adminRoutes } from './lib/admin';
import { adminUserRoutes } from './lib/admin-users';
import { clientCatalog, clientHeartbeat, clientLaunch, clientLogout, clientRequestSessionChecks, clientSessionFallback, clientSessionHealth } from './lib/client';
import { adminProfileUsageRoutes, clientCloseProfileUsage } from './lib/profile-usage';
import { publicClientUpdateRoutes, pruneClientReleaseStorage } from './lib/client-updates';
import { MIN_SESSION_MANAGER_VERSION, MIN_USERFLOW_VERSION, clientVersionFrom, versionAtLeast } from './lib/release-compat';
import { cleanupRuntimeState } from './lib/maintenance';
import { adminClientReleaseRoutes } from './lib/client-release-admin';
import { planAccessRoutes } from './lib/plan-access';
import { serveProfileImage, serveProfileImageObject, uploadProfileImage } from './lib/profile-images';
import { profilePlanAccessRoutes } from './lib/profile-plan-access';
import { profileProxyDefaultRoutes } from './lib/profile-proxy-defaults';
import { adminProxyRoutes } from './lib/proxy-admin';
import { adminProfileSessionRoutes, publicSessionManagerRoutes } from './lib/profile-sessions';
import { adminExtensionRoutes, clientExtensionPackage, publicExtensionTestRoutes } from './lib/extensions';
import {
  Env,
  HttpError,
  json,
  sb,
  requireSameOriginWrite,
  securityHeaders,
  withSecurity,
} from './lib/core';

const APP_VERSION = '1.4.35';

function assertMinimumUserflowVersion(request: Request) {
  const version = clientVersionFrom(request);
  if (!versionAtLeast(version, MIN_USERFLOW_VERSION)) {
    throw new HttpError(
      426,
      'CLIENT_UPDATE_REQUIRED',
      `Actualiza userFLOW a v${MIN_USERFLOW_VERSION} o superior antes de iniciar sesión.`,
    );
  }
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

  if (path === '/api/health' && method === 'GET') {
    let databaseReachable = false;
    let databaseError: string | null = null;
    try {
      const probe = await sb(env, 'vsixteen_users?select=id&limit=1');
      databaseReachable = Array.isArray(probe);
    } catch (error) {
      databaseError = error instanceof HttpError ? error.code : 'DATABASE_PROBE_FAILED';
    }
    return json({
      ok: true,
      service: 'userFLEX Admin API',
      version: APP_VERSION,
      databaseConfigured: Boolean(env.NEON_DATABASE_URL),
      databaseBackend: 'neon',
      databaseReachable,
      databaseError,
      updateStorage: env.CLIENT_RELEASES ? 'cloudflare-r2' : 'missing',
      profileImageStorage: env.PROFILE_IMAGES ? 'cloudflare-r2' : 'missing',
      proxyEncryptionConfigured: Boolean(env.USERFLEX_PROXY_MASTER_KEY),
      minimumClientVersion: MIN_USERFLOW_VERSION,
      minimumSessionManagerVersion: MIN_SESSION_MANAGER_VERSION,
      timestamp: new Date().toISOString(),
    });
  }

  const updateResponse = await publicClientUpdateRoutes(request, env);
  if (updateResponse) return updateResponse;

  const publicProfileImageObject = path.match(/^\/api\/profile-image-files\/(profiles\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/i);
  if (publicProfileImageObject && (method === 'GET' || method === 'HEAD')) {
    return serveProfileImageObject(request, env, publicProfileImageObject[1]);
  }

  const publicProfileImage = path.match(/^\/api\/profile-images\/([0-9a-f-]{36})$/i);
  if (publicProfileImage && (method === 'GET' || method === 'HEAD')) {
    return serveProfileImage(request, env, publicProfileImage[1]);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    requireSameOriginWrite(request);
    return adminLogin(request, env);
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    requireSameOriginWrite(request);
    return adminLogout(request, env);
  }

  if (path === '/api/client/auth' && method === 'POST') {
    assertMinimumUserflowVersion(request);
    return clientLogin(request, env);
  }

  if (
    path.startsWith('/api/session-manager/')
    || path.startsWith('/api/session-keeper/')
    || path.startsWith('/api/client-test/')
  ) {
    const response = await publicSessionManagerRoutes(request, env);
    if (response) return response;
    throw new HttpError(404, 'NOT_FOUND');
  }

  if (path.startsWith('/api/extension-test/')) {
    const response = await publicExtensionTestRoutes(request, env);
    if (response) return response;
    throw new HttpError(404, 'NOT_FOUND');
  }

  if (path.startsWith('/api/client/')) {
    const identity = await requireClient(request, env);
    if (path === '/api/client/catalog' && method === 'GET') {
      assertMinimumUserflowVersion(request);
      return clientCatalog(request, env, identity);
    }
    if (path === '/api/client/heartbeat' && method === 'POST') return clientHeartbeat(request, env, identity);
    if (path === '/api/client/session-checks/request' && method === 'POST') return clientRequestSessionChecks(request, env, identity);
    if (path === '/api/client/logout' && method === 'POST') return clientLogout(env, identity);
    const sessionHealth = path.match(/^\/api\/client\/profiles\/([0-9a-f-]{36})\/session-health$/i);
    if (sessionHealth && method === 'POST') return clientSessionHealth(request, env, identity, sessionHealth[1]);
    const sessionFallback = path.match(/^\/api\/client\/profiles\/([0-9a-f-]{36})\/session-fallback$/i);
    if (sessionFallback && method === 'POST') return clientSessionFallback(request, env, identity, sessionFallback[1]);
    const launch = path.match(/^\/api\/client\/profiles\/([0-9a-f-]{36})\/launch$/i);
    if (launch && method === 'POST') return clientLaunch(request, env, identity, launch[1]);
    const extensionPackage = path.match(/^\/api\/client\/extensions\/([0-9a-f-]{36})\/package$/i);
    if (extensionPackage && method === 'GET') return clientExtensionPackage(request, env, identity, extensionPackage[1]);
    const usageClose = path.match(/^\/api\/client\/profile-usage\/([0-9a-f-]{36})\/close$/i);
    if (usageClose && method === 'POST') return clientCloseProfileUsage(request, env, identity, usageClose[1]);
    throw new HttpError(404, 'NOT_FOUND');
  }

  const admin = await requireAdmin(request, env);
  if (path === '/api/auth/session' && method === 'GET') {
    return json({
      ok: true,
      user: {
        id: admin.userId,
        username: admin.username,
        display_name: admin.displayName,
        email: admin.email,
        role: admin.role,
      },
    });
  }

  requireSameOriginWrite(request);
  if (path === '/api/profile-images' && method === 'POST') {
    return uploadProfileImage(request, env, admin);
  }
  const releaseResponse = await adminClientReleaseRoutes(request, env, admin);
  if (releaseResponse) return releaseResponse;
  const adminUserResponse = await adminUserRoutes(request, env, admin);
  if (adminUserResponse) return adminUserResponse;
  const extensionResponse = await adminExtensionRoutes(request, env, admin);
  if (extensionResponse) return extensionResponse;
  const profileUsageResponse = await adminProfileUsageRoutes(request, env, admin);
  if (profileUsageResponse) return profileUsageResponse;
  const profileProxyResponse = await profileProxyDefaultRoutes(request, env, admin);
  if (profileProxyResponse) return profileProxyResponse;
  const proxyResponse = await adminProxyRoutes(request, env, admin);
  if (proxyResponse) return proxyResponse;
  const profileSessionResponse = await adminProfileSessionRoutes(request, env, admin);
  if (profileSessionResponse) return profileSessionResponse;
  const profilePlanResponse = await profilePlanAccessRoutes(request, env, admin);
  if (profilePlanResponse) return profilePlanResponse;
  const planAccessResponse = await planAccessRoutes(request, env, admin);
  if (planAccessResponse) return planAccessResponse;
  return adminRoutes(request, env, admin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const suppliedId = String(request.headers.get('X-Userflex-Request-Id') || '');
    const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
    const withRequestId = (response: Response) => {
      const headers = new Headers(response.headers);
      headers.set('X-Userflex-Request-Id', requestId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return withRequestId(await api(request, env));
      if (!env.ASSETS) {
        return withRequestId(withSecurity(new Response('userFLEX Admin assets not configured', { status: 503 })));
      }
      return withRequestId(withSecurity(await env.ASSETS.fetch(request)));
    } catch (error) {
      if (error instanceof HttpError) {
        return withRequestId(json({ ok: false, error: error.message, code: error.code, requestId }, error.status));
      }
      console.error('Unhandled userFLEX Worker error', requestId, error instanceof Error ? error.message : String(error));
      return withRequestId(json({ ok: false, error: 'Error interno del servidor.', code: 'INTERNAL_ERROR', requestId }, 500));
    }
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      const result = await cleanupRuntimeState(env);
      const releaseCleanup = env.CLIENT_RELEASES
        ? await pruneClientReleaseStorage(env, 2).catch((error) => ({
            storage: 'cloudflare-r2',
            error: error instanceof Error ? error.message : String(error),
          }))
        : { storage: 'missing' };
      console.log('userFLEX runtime maintenance', JSON.stringify({ ...result, releaseCleanup }));
    } catch (error) {
      console.error('userFLEX runtime maintenance failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  },
};
