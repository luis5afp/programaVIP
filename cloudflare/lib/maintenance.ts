import { Env, sb } from './core';

function encodedNow() {
  return encodeURIComponent(new Date().toISOString());
}

export async function cleanupRuntimeState(env: Env) {
  const now = new Date().toISOString();
  const nowEncoded = encodedNow();

  const [expiredSessions, revokedSessions] = await Promise.all([
    sb(
      env,
      `userflex_client_sessions?select=id&revoked_at=is.null&expires_at=lte.${nowEncoded}`,
    ),
    sb(
      env,
      'userflex_client_sessions?select=id&revoked_at=not.is.null',
    ),
  ]);

  const expiredIds = (expiredSessions || []).map((row: any) => String(row.id)).filter(Boolean);
  if (expiredIds.length) {
    await sb(env, `userflex_client_sessions?id=in.(${expiredIds.join(',')})&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: now, last_seen_at: now }),
    });
  }

  const inactiveIds = Array.from(new Set([
    ...expiredIds,
    ...(revokedSessions || []).map((row: any) => String(row.id)).filter(Boolean),
  ]));
  if (inactiveIds.length) {
    await sb(env, `userflex_profile_usage?client_session_id=in.(${inactiveIds.join(',')})&closed_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        closed_at: now,
        close_reason: 'session_expired',
        updated_at: now,
      }),
    });
  }

  await sb(env, `userflex_profile_usage?client_session_id=is.null&closed_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      closed_at: now,
      close_reason: 'session_missing',
      updated_at: now,
    }),
  });

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
    inactiveSessionIds: inactiveIds.length,
    ranAt: now,
  };
}
