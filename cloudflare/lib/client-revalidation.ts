import { Env, sb } from './core';

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function touchClientConfig(env: Env, clientId: string): Promise<void> {
  await sb(env, `userflex_clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

export async function touchClientsConfig(env: Env, clientIds: string[]): Promise<void> {
  const ids = uniqueIds(clientIds);
  if (!ids.length) return;
  await sb(env, `userflex_clients?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
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
