import { AdminIdentity, ClientIdentity } from './auth';
import { Env, HttpError, bodyJson, json, sb, uuid } from './core';

const TRACKING_HEADER = 'x-userflow-profile-usage';
const VERSION_HEADER = 'x-userflow-client-version';

function safeReason(value: unknown) {
  if (typeof value !== 'string') return 'closed';
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return cleaned || 'closed';
}

export async function openProfileUsage(
  request: Request,
  env: Env,
  id: ClientIdentity,
  profile: { id: string; name: string; url: string },
) {
  if (request.headers.get(TRACKING_HEADER) !== '1') return null;

  const devices = await sb(
    env,
    `userflex_devices?select=id,name,os&id=eq.${id.deviceId}&client_id=eq.${id.clientId}&limit=1`,
  );
  const device = devices?.[0] || null;
  const openedAt = new Date().toISOString();
  const clientVersion = (request.headers.get(VERSION_HEADER) || '').trim().slice(0, 32) || null;
  const ip = request.headers.get('cf-connecting-ip') || null;

  const rows = await sb(env, 'userflex_profile_usage', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      client_id: id.clientId,
      device_id: id.deviceId,
      profile_id: profile.id,
      client_session_id: id.sessionId,
      client_name: id.client.name,
      client_email: id.client.email || null,
      device_name: device?.name || null,
      device_os: device?.os || null,
      profile_name: profile.name,
      profile_url: profile.url,
      client_version: clientVersion,
      ip,
      opened_at: openedAt,
      updated_at: openedAt,
    }),
  });
  const usage = rows?.[0];
  if (!usage?.id) throw new HttpError(500, 'PROFILE_USAGE_CREATE_FAILED');
  return { id: usage.id, openedAt: usage.opened_at || openedAt };
}

export async function clientCloseProfileUsage(
  request: Request,
  env: Env,
  id: ClientIdentity,
  usageIdRaw: string,
) {
  const usageId = uuid(usageIdRaw, 'usageId');
  const body = await bodyJson(request).catch(() => ({}));
  const reason = safeReason(body?.reason);
  const closedAt = new Date().toISOString();
  const rows = await sb(
    env,
    `userflex_profile_usage?id=eq.${usageId}&client_id=eq.${id.clientId}&device_id=eq.${id.deviceId}&client_session_id=eq.${id.sessionId}&closed_at=is.null`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ closed_at: closedAt, close_reason: reason, updated_at: closedAt }),
    },
  );
  return json({ ok: true, usageId, closedAt: rows?.[0]?.closed_at || null });
}

async function closeOpenUsage(env: Env, filter: string, reason: string) {
  const closedAt = new Date().toISOString();
  await sb(env, `userflex_profile_usage?${filter}&closed_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ closed_at: closedAt, close_reason: safeReason(reason), updated_at: closedAt }),
  });
}

export async function closeOpenProfileUsageForSession(env: Env, sessionId: string, reason: string) {
  return closeOpenUsage(env, `client_session_id=eq.${sessionId}`, reason);
}

export async function closeOpenProfileUsageForClient(env: Env, clientId: string, reason: string) {
  return closeOpenUsage(env, `client_id=eq.${clientId}`, reason);
}

export async function closeOpenProfileUsageForDevice(env: Env, deviceId: string, reason: string) {
  return closeOpenUsage(env, `device_id=eq.${deviceId}`, reason);
}

export async function adminProfileUsageRoutes(
  request: Request,
  env: Env,
  _admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/profile-usage' || request.method.toUpperCase() !== 'GET') return null;

  const limitRaw = Number(url.searchParams.get('limit') || 1000);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 2000)) : 1000;
  const filters: string[] = [];
  const clientId = url.searchParams.get('clientId');
  const deviceId = url.searchParams.get('deviceId');
  const profileId = url.searchParams.get('profileId');
  if (clientId) filters.push(`client_id=eq.${uuid(clientId, 'clientId')}`);
  if (deviceId) filters.push(`device_id=eq.${uuid(deviceId, 'deviceId')}`);
  if (profileId) filters.push(`profile_id=eq.${uuid(profileId, 'profileId')}`);

  const suffix = filters.length ? `&${filters.join('&')}` : '';
  const rows = await sb(
    env,
    `userflex_profile_usage?select=id,client_id,device_id,profile_id,client_name,client_email,device_name,device_os,profile_name,profile_url,client_version,ip,opened_at,closed_at,close_reason&order=opened_at.desc&limit=${limit}${suffix}`,
  );
  return json(rows);
}
