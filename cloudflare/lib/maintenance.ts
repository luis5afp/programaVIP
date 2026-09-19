import { Env, sb } from './core';

function encodedNow() {
  return encodeURIComponent(new Date().toISOString());
}

export async function cleanupRuntimeState(env: Env) {
  const now = new Date().toISOString();
  const nowEncoded = encodedNow();

  const [expiredSessions, openUsage] = await Promise.all([
    sb(
      env,
      `userflex_client_sessions?select=id&revoked_at=is.null&expires_at=lte.${nowEncoded}&limit=5000`,
    ),
    sb(
      env,
      'userflex_profile_usage?select=id,client_session_id&closed_at=is.null&limit=5000',
    ),
  ]);

  const expiredIds = (expiredSessions || []).map((row: any) => String(row.id)).filter(Boolean);
  if (expiredIds.length) {
    await sb(env, `userflex_client_sessions?id=in.(${expiredIds.join(',')})&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: now }),
    });
  }

  const openSessionIds = Array.from(new Set(
    (openUsage || [])
      .map((row: any) => row.client_session_id ? String(row.client_session_id) : null)
      .filter(Boolean),
  )) as string[];

  let inactiveIds = new Set(expiredIds);
  if (openSessionIds.length) {
    const sessions = await sb(
      env,
      `userflex_client_sessions?select=id,revoked_at,expires_at&id=in.(${openSessionIds.join(',')})`,
    );
    const sessionById = new Map((sessions || []).map((row: any) => [String(row.id), row]));
    for (const sessionId of openSessionIds) {
      const session: any = sessionById.get(sessionId);
      if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
        inactiveIds.add(sessionId);
      }
    }
  }

  const staleUsageIds = (openUsage || [])
    .filter((row: any) => !row.client_session_id || inactiveIds.has(String(row.client_session_id)))
    .map((row: any) => String(row.id))
    .filter(Boolean);

  if (staleUsageIds.length) {
    await sb(env, `userflex_profile_usage?id=in.(${staleUsageIds.join(',')})&closed_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        closed_at: now,
        close_reason: 'session_expired',
        updated_at: now,
      }),
    });
  }

  await sb(env, `userflex_profile_session_jobs?status=eq.pending&expires_at=lte.${nowEncoded}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'expired' }),
  });

  await sb(env, `userflex_profile_validation_jobs?status=in.(pending,running)&expires_at=lte.${nowEncoded}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'expired', completed_at: now }),
  });

  return {
    expiredClientSessions: expiredIds.length,
    staleUsageClosed: staleUsageIds.length,
    ranAt: now,
  };
}
