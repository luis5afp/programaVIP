import { Env, sb } from './core';

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '')).filter(Boolean))];
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
}

export async function clientIdsForPlans(env: Env, planIds: string[]): Promise<string[]> {
  const ids = uniqueIds(planIds);
  if (!ids.length) return [];
  const rows = await sb(
    env,
    `userflex_subscriptions?select=client_id&status=eq.active&plan_id=in.(${ids.join(',')})`,
  );
  return uniqueIds((rows || []).map((row: any) => String(row.client_id)));
}

export async function clientIdsForProfile(env: Env, profileId: string): Promise<string[]> {
  const rows = await sb(
    env,
    `userflex_plan_profiles?select=plan_id&profile_id=eq.${profileId}`,
  );
  return clientIdsForPlans(env, (rows || []).map((row: any) => String(row.plan_id)));
}

export async function clientIdsForProxy(env: Env, proxyId: string): Promise<string[]> {
  const [assignments, defaults] = await Promise.all([
    sb(env, `userflex_assignments?select=client_id&proxy_id=eq.${proxyId}`),
    sb(env, `userflex_profile_proxy_defaults?select=profile_id&proxy_id=eq.${proxyId}`),
  ]);
  const direct = (assignments || []).map((row: any) => String(row.client_id));
  const inherited: string[] = [];
  for (const row of defaults || []) {
    inherited.push(...await clientIdsForProfile(env, String(row.profile_id)));
  }
  return uniqueIds([...direct, ...inherited]);
}

export async function touchPlanClients(env: Env, planIds: string[]): Promise<void> {
  await touchClientsConfig(env, await clientIdsForPlans(env, planIds));
}

export async function touchProfileClients(env: Env, profileId: string): Promise<void> {
  await touchClientsConfig(env, await clientIdsForProfile(env, profileId));
}

export async function touchProxyClients(env: Env, proxyId: string): Promise<void> {
  await touchClientsConfig(env, await clientIdsForProxy(env, proxyId));
}
