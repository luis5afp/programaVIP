import { Env, sb, sha } from './core';

const CONFIG_EVENT = 'config_changed';
const BROADCAST_BATCH_SIZE = 100;

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function clientRealtimeTopic(env: Env, clientId: string): Promise<string | null> {
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!secret || !clientId) return null;
  const digest = await sha(`userflex-config:${clientId}:${secret}`);
  return `userflex-config:${digest}`;
}

export async function clientRealtimeConfig(env: Env, clientId: string) {
  const topic = await clientRealtimeTopic(env, clientId);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!topic || !base || !key) return null;
  return { url: base, key, topic, event: CONFIG_EVENT };
}

export async function notifyClientsConfig(
  env: Env,
  clientIds: string[],
  revision = new Date().toISOString(),
): Promise<void> {
  const ids = uniqueIds(clientIds);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!ids.length || !base || !key) return;

  const messages = (
    await Promise.all(ids.map(async (clientId) => {
      const topic = await clientRealtimeTopic(env, clientId);
      return topic
        ? {
            topic,
            event: CONFIG_EVENT,
            payload: { revision },
          }
        : null;
    }))
  ).filter(Boolean);

  for (let index = 0; index < messages.length; index += BROADCAST_BATCH_SIZE) {
    const batch = messages.slice(index, index + BROADCAST_BATCH_SIZE);
    try {
      const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: batch }),
      });
      if (!response.ok) {
        console.warn('userFLEX Realtime broadcast failed:', response.status);
      }
    } catch (error: any) {
      console.warn('userFLEX Realtime broadcast unavailable:', error?.message || error);
    }
  }
}

export async function touchClientConfig(env: Env, clientId: string): Promise<void> {
  await touchClientsConfig(env, [clientId]);
}

export async function touchClientsConfig(env: Env, clientIds: string[]): Promise<void> {
  const ids = uniqueIds(clientIds);
  if (!ids.length) return;
  const revision = new Date().toISOString();
  await sb(env, `userflex_clients?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: revision }),
  });
  await notifyClientsConfig(env, ids, revision);
}

export async function touchPlanClients(env: Env, planIds: string[]): Promise<void> {
  const ids = uniqueIds(planIds);
  if (!ids.length) return;
  const rows = await sb(
    env,
    `userflex_subscriptions?select=client_id&status=eq.active&plan_id=in.(${ids.join(',')})`,
  );
  await touchClientsConfig(env, (rows || []).map((row: any) => String(row.client_id)));
}

export async function touchProfileClients(env: Env, profileId: string): Promise<void> {
  const rows = await sb(
    env,
    `userflex_plan_profiles?select=plan_id&profile_id=eq.${profileId}`,
  );
  await touchPlanClients(env, (rows || []).map((row: any) => String(row.plan_id)));
}

export async function touchProxyClients(env: Env, proxyId: string): Promise<void> {
  const [assignments, defaults] = await Promise.all([
    sb(env, `userflex_assignments?select=client_id&proxy_id=eq.${proxyId}`),
    sb(env, `userflex_profile_proxy_defaults?select=profile_id&proxy_id=eq.${proxyId}`),
  ]);
  await touchClientsConfig(env, (assignments || []).map((row: any) => String(row.client_id)));
  for (const row of defaults || []) {
    await touchProfileClients(env, String(row.profile_id));
  }
}
