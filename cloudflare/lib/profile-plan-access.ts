import { AdminIdentity } from './auth';
import { Env, HttpError, audit, bodyJson, json, sb, uuid } from './core';

function selectedPlanIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'PROFILE_PLANS_REQUIRED', 'La lista de planes del perfil debe ser válida.');
  }
  const ids = [...new Set(value.map((item) => uuid(item, 'planId')))];
  if (ids.length > 200) throw new HttpError(400, 'TOO_MANY_PROFILE_PLANS');
  return ids;
}

async function verifyProfile(env: Env, profileId: string) {
  const rows = await sb(env, `userflex_profiles?select=id&id=eq.${profileId}&limit=1`);
  if (!rows?.[0]) throw new HttpError(404, 'PROFILE_NOT_FOUND');
}

async function verifyPlans(env: Env, ids: string[]) {
  if (!ids.length) return;
  const rows = await sb(env, `userflex_plans?select=id&id=in.(${ids.join(',')})`);
  if (rows.length !== ids.length) {
    throw new HttpError(400, 'PROFILE_PLAN_NOT_FOUND', 'Uno de los planes seleccionados ya no existe.');
  }
}

async function syncPlanProfileCount(env: Env, planId: string) {
  const rows = await sb(env, `userflex_plan_profiles?select=profile_id&plan_id=eq.${planId}`);
  await sb(env, `userflex_plans?id=eq.${planId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      max_profiles: Math.max(1, rows.length),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function replaceProfilePlans(env: Env, profileId: string, planIds: string[]) {
  const existing = await sb(
    env,
    `userflex_plan_profiles?select=plan_id&profile_id=eq.${profileId}`,
  );
  const previousPlanIds = existing.map((row: any) => String(row.plan_id));

  await sb(env, `userflex_plan_profiles?profile_id=eq.${profileId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  if (planIds.length) {
    await sb(env, 'userflex_plan_profiles', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(planIds.map((planId) => ({ plan_id: planId, profile_id: profileId }))),
    });
  }

  const affectedPlanIds = [...new Set([...previousPlanIds, ...planIds])];
  await Promise.all(
    affectedPlanIds.map(async (planId) => {
      await syncPlanProfileCount(env, planId);
      await sb(env, 'rpc/userflex_disable_disallowed_assignments', {
        method: 'POST',
        body: JSON.stringify({ p_plan_id: planId }),
      });
    }),
  );
}

export async function profilePlanAccessRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/profile-plan-memberships' && method === 'GET') {
    return json(await sb(
      env,
      'userflex_plan_profiles?select=profile_id,plan_id,created_at&order=created_at.asc',
    ));
  }

  const match = path.match(/^\/api\/profiles\/([0-9a-f-]{36})\/plans$/i);
  if (match && method === 'POST') {
    const profileId = uuid(match[1], 'profileId');
    const body = await bodyJson(request);
    const planIds = selectedPlanIds(body.planIds);
    await Promise.all([
      verifyProfile(env, profileId),
      verifyPlans(env, planIds),
    ]);
    await replaceProfilePlans(env, profileId, planIds);
    await audit(env, request, 'admin', admin.userId, 'profile.plans.update', 'profile', profileId, {
      planCount: planIds.length,
    });
    return json({ ok: true, profile_id: profileId, plan_ids: planIds });
  }

  return null;
}
