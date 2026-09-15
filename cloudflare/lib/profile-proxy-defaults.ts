import type { AdminIdentity } from './auth';
import { touchProfileClients } from './client-revalidation';
import { Env, HttpError, audit, bodyJson, json, sb, uuid } from './core';

export async function profileProxyDefaultRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/profile-proxy-defaults' && method === 'GET') {
    return json(
      await sb(
        env,
        'userflex_profile_proxy_defaults?select=profile_id,proxy_id,updated_at&order=updated_at.desc',
      ),
    );
  }

  const match = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/default-proxy$/i);
  if (!match || method !== 'POST') return null;

  const profileId = uuid(match[1], 'profileId');
  const body = await bodyJson(request);
  const proxyId = body.proxyId ? uuid(body.proxyId, 'proxyId') : null;

  const profileRows = await sb(env, `userflex_profiles?select=id&id=eq.${profileId}&limit=1`);
  if (!profileRows?.[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND');

  if (!proxyId) {
    await sb(env, `userflex_profile_proxy_defaults?profile_id=eq.${profileId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await touchProfileClients(env, profileId);
    await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.clear', 'profile', profileId);
    return json({ ok: true, profile_id: profileId, proxy_id: null });
  }

  const proxyRows = await sb(env, `userflex_proxies?select=id&id=eq.${proxyId}&limit=1`);
  if (!proxyRows?.[0]) throw new HttpError(404, 'PROXY_NOT_FOUND');

  const rows = await sb(env, 'userflex_profile_proxy_defaults?on_conflict=profile_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      profile_id: profileId,
      proxy_id: proxyId,
      updated_at: new Date().toISOString(),
    }),
  });

  await touchProfileClients(env, profileId);
  await audit(env, request, 'admin', admin.userId, 'profile.default_proxy.set', 'profile', profileId, {
    proxyId,
  });
  return json({ ok: true, profile_id: profileId, proxy_id: rows?.[0]?.proxy_id || proxyId });
}
