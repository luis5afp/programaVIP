import { Env, sb, sha } from './core';

const KEEPER_EVENT = 'keeper_check';
const BROADCAST_BATCH_SIZE = 100;
const KEEPER_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '')).filter(Boolean))];
}

export async function keeperRealtimeTopic(env: Env, profileId: string): Promise<string | null> {
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!secret || !profileId) return null;
  const digest = await sha(`userflex-keeper:${profileId}:${secret}`);
  return `userflex-keeper:${digest}`;
}

export async function keeperRealtimeConfig(env: Env, profileId: string) {
  const topic = await keeperRealtimeTopic(env, profileId);
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!topic || !base || !key) return null;
  return { url: base, key, topic, event: KEEPER_EVENT };
}

export async function requestKeeperChecks(
  env: Env,
  profileIds: string[],
  reason: 'admin-start' | 'client-start' | 'profile-update' | 'credentials-update',
): Promise<number> {
  // Opening Admin or logging a client in must never fan out browser checks for
  // every managed profile. Those startup calls are kept for backwards
  // compatibility with already-installed clients/Admin bundles, but they are
  // intentionally passive.
  if (reason === 'admin-start' || reason === 'client-start') return 0;

  const ids = uniqueIds(profileIds);
  if (!ids.length) return 0;

  const keepers = await sb(
    env,
    `userflex_session_keepers?select=profile_id,last_check_at&enabled=eq.true&profile_id=in.(${ids.join(',')})`,
  );
  const bypassCooldown = reason === 'profile-update' || reason === 'credentials-update';
  const now = Date.now();
  const enabledProfileIds = uniqueIds((keepers || [])
    .filter((row: any) => {
      if (bypassCooldown) return true;
      const lastCheck = Date.parse(String(row.last_check_at || ''));
      return !Number.isFinite(lastCheck) || now - lastCheck >= KEEPER_REQUEST_COOLDOWN_MS;
    })
    .map((row: any) => String(row.profile_id)));
  if (!enabledProfileIds.length) return 0;

  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) return 0;

  const requestedAt = new Date().toISOString();
  const messages = (
    await Promise.all(enabledProfileIds.map(async (profileId) => {
      const topic = await keeperRealtimeTopic(env, profileId);
      return topic ? {
        topic,
        event: KEEPER_EVENT,
        payload: { profileId, reason, requestedAt },
      } : null;
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
        console.warn('userFLEX Keeper Realtime broadcast failed:', response.status);
      }
    } catch (error: any) {
      console.warn('userFLEX Keeper Realtime unavailable:', error?.message || error);
    }
  }

  return enabledProfileIds.length;
}

export async function requestAllKeeperChecks(
  env: Env,
  reason: 'admin-start',
): Promise<number> {
  const keepers = await sb(env, 'userflex_session_keepers?select=profile_id&enabled=eq.true');
  return requestKeeperChecks(
    env,
    (keepers || []).map((row: any) => String(row.profile_id)),
    reason,
  );
}
