import { adminLogin, adminLogout, clientLogin, requireAdmin, requireClient } from './lib/auth';
import { adminRoutes } from './lib/admin';
import { adminUserRoutes } from './lib/admin-users';
import { clientCatalog, clientHeartbeat, clientLaunch, clientLogout } from './lib/client';
import { adminProfileUsageRoutes, clientCloseProfileUsage } from './lib/profile-usage';
import { publicClientUpdateRoutes } from './lib/client-updates';
import { planAccessRoutes } from './lib/plan-access';
import { uploadProfileImage } from './lib/profile-images';
import { profilePlanAccessRoutes } from './lib/profile-plan-access';
import { profileProxyDefaultRoutes } from './lib/profile-proxy-defaults';
import { adminProfileSessionRoutes, publicSessionManagerRoutes } from './lib/profile-sessions';
import {
  Env,
  HttpError,
  json,
  requireSameOriginWrite,
  securityHeaders,
  withSecurity,
} from './lib/core';

const APP_VERSION = '1.2.8';

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

  if (path === '/api/health' && method === 'GET') {
    return json({
      ok: true,
      service: 'userFLEX Admin API',
      version: APP_VERSION,
      supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      proxyEncryptionConfigured: Boolean(env.USERFLEX_PROXY_MASTER_KEY),
      timestamp: new Date().toISOString(),
    });
  }

  const updateResponse = await publicClientUpdateRoutes(request, env);
  if (updateResponse) return updateResponse;

  if (path === '/api/auth/login' && method === 'POST') {
    requireSameOriginWrite(request);
    return adminLogin(request, env);
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    requireSameOriginWrite(request);
    return adminLogout(request, env);
  }

  if (path === '/api/client/auth' && method === 'POST') {
    return clientLogin(request, env);
  }

  if (path.startsWith('/api/session-manager/')) {
    const response = await publicSessionManagerRoutes(request, env);
    if (response) return response;
    throw new HttpError(404, 'NOT_FOUND');
  }

  if (path.startsWith('/api/client/')) {
    const identity = await requireClient(request, env);
    if (path === '/api/client/catalog' && method === 'GET') return clientCatalog(env, identity);
    if (path === '/api/client/heartbeat' && method === 'POST') return clientHeartbeat(env, identity);
    if (path === '/api/client/logout' && method === 'POST') return clientLogout(env, identity);
    const launch = path.match(/^\/api\/client\/profiles\/([0-9a-f-]{36})\/launch$/i);
    if (launch && method === 'POST') return clientLaunch(request, env, identity, launch[1]);
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
  const adminUserResponse = await adminUserRoutes(request, env, admin);
  if (adminUserResponse) return adminUserResponse;
  const profileUsageResponse = await adminProfileUsageRoutes(request, env, admin);
  if (profileUsageResponse) return profileUsageResponse;
  const profileProxyResponse = await profileProxyDefaultRoutes(request, env, admin);
  if (profileProxyResponse) return profileProxyResponse;
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
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await api(request, env);
      if (!env.ASSETS) {
        return withSecurity(new Response('userFLEX Admin assets not configured', { status: 503 }));
      }
      return withSecurity(await env.ASSETS.fetch(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ ok: false, error: error.message, code: error.code }, error.status);
      }
      console.error('Unhandled userFLEX Worker error', error instanceof Error ? error.message : String(error));
      return json({ ok: false, error: 'Error interno del servidor.', code: 'INTERNAL_ERROR' }, 500);
    }
  },
};
