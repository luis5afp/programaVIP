import { AdminIdentity } from './auth';
import {
  Env,
  HttpError,
  audit,
  bodyJson,
  integer,
  json,
  sb,
  text,
  uuid,
} from './core';

function selectedProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'PLAN_PROFILES_REQUIRED', 'Selecciona al menos un perfil permitido para el plan.');
  }
  const ids = [...new Set(value.map((item) => uuid(item, 'profileId')))];
  if (ids.length === 0) {
    throw new HttpError(400, 'PLAN_PROFILES_REQUIRED', 'Selecciona al menos un perfil permitido para el plan.');
  }
  if (ids.length > 500) throw new HttpError(400, 'TOO_MANY_PLAN_PROFILES');
  return ids;
}

async function verifyProfiles(env: Env, ids: string[]) {
  const rows = await sb(env, `userflex_profiles?select=id&id=in.(${ids.join(',')})`);
  if (rows.length !== ids.length) {
    throw new HttpError(400, 'PLAN_PROFILE_NOT_FOUND', 'Uno de los perfiles seleccionados ya no existe.');
  }
}

async function planDetails(env: Env, rows?: any[]) {
  const plans = rows || await sb(
    env,
    'userflex_plans?select=id,name,duration_days,max_devices,max_profiles,enabled,created_at,updated_at&order=name.asc',
  );
  if (!plans.length) return [];
  const ids = plans.map((plan: any) => plan.id).join(',');
  const access = await sb(
    env,
    `userflex_plan_profiles?select=plan_id,profile_id&plan_id=in.(${ids})&order=created_at.asc`,
  );
  const byPlan = new Map<string, string[]>();
  for (const row of access) {
    const current = byPlan.get(row.plan_id) || [];
    current.push(row.profile_id);
    byPlan.set(row.plan_id, current);
  }
  return plans.map((plan: any) => ({ ...plan, profile_ids: byPlan.get(plan.id) || [] }));
}

async function replacePlanProfiles(env: Env, planId: string, profileIds: string[]) {
  await sb(env, `userflex_plan_profiles?plan_id=eq.${planId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  await sb(env, 'userflex_plan_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(profileIds.map((profileId) => ({ plan_id: planId, profile_id: profileId }))),
  });
  await sb(env, 'rpc/userflex_disable_disallowed_assignments', {
    method: 'POST',
    body: JSON.stringify({ p_plan_id: planId }),
  });
}

async function requirePlanAllowsAssignment(env: Env, clientId: string, profileId: string) {
  const result = await sb(env, 'rpc/userflex_plan_allows_profile', {
    method: 'POST',
    body: JSON.stringify({ p_client_id: clientId, p_profile_id: profileId }),
  });
  const allowed = Array.isArray(result) ? result[0] : result;
  if (allowed !== true) {
    throw new HttpError(
      409,
      'PROFILE_NOT_ALLOWED_BY_PLAN',
      'El perfil seleccionado no está permitido por el plan activo de este cliente.',
    );
  }
}

async function assignmentResponse(env: Env, id: string) {
  const rows = await sb(
    env,
    `userflex_assignments?select=id,client_id,profile_id,proxy_id,enabled,created_at,updated_at&id=eq.${id}&limit=1`,
  );
  return rows?.[0] || null;
}

export async function planAccessRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/plans' && method === 'GET') {
    return json(await planDetails(env));
  }

  if (path === '/api/plans' && method === 'POST') {
    const body = await bodyJson(request);
    const profileIds = selectedProfileIds(body.profile_ids);
    await verifyProfiles(env, profileIds);
    const row = {
      name: text(body.name, 'name', 80),
      duration_days: body.duration_days === null ? null : integer(body.duration_days, 1, 3650, 'duration_days'),
      max_devices: integer(body.max_devices, 1, 50, 'max_devices'),
      max_profiles: integer(body.max_profiles, 1, 500, 'max_profiles'),
      enabled: body.enabled !== false,
    };
    const rows = await sb(env, 'userflex_plans', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    const plan = rows?.[0];
    if (!plan) throw new HttpError(500, 'PLAN_CREATE_FAILED');
    try {
      await replacePlanProfiles(env, plan.id, profileIds);
    } catch (error) {
      await sb(env, `userflex_plans?id=eq.${plan.id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }).catch(() => null);
      throw error;
    }
    await audit(env, request, 'admin', admin.userId, 'plan.create', 'plan', plan.id, {
      profileCount: profileIds.length,
    });
    return json({ ...plan, profile_ids: profileIds }, 201);
  }

  const planMatch = path.match(/^\/api\/plans\/([0-9a-f-]{36})$/i);
  if (planMatch && method === 'PATCH') {
    const planId = uuid(planMatch[1], 'planId');
    const body = await bodyJson(request);
    const profileIds = body.profile_ids === undefined ? null : selectedProfileIds(body.profile_ids);
    if (profileIds) await verifyProfiles(env, profileIds);

    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 80);
    if (body.duration_days !== undefined) {
      patch.duration_days = body.duration_days === null
        ? null
        : integer(body.duration_days, 1, 3650, 'duration_days');
    }
    if (body.max_devices !== undefined) patch.max_devices = integer(body.max_devices, 1, 50, 'max_devices');
    if (body.max_profiles !== undefined) patch.max_profiles = integer(body.max_profiles, 1, 500, 'max_profiles');
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

    const rows = await sb(env, `userflex_plans?id=eq.${planId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!rows?.[0]) throw new HttpError(404, 'PLAN_NOT_FOUND');
    if (profileIds) await replacePlanProfiles(env, planId, profileIds);
    const detailed = (await planDetails(env, rows))[0];
    await audit(env, request, 'admin', admin.userId, 'plan.update', 'plan', planId, {
      profileCount: detailed.profile_ids.length,
    });
    return json(detailed);
  }

  if (planMatch && method === 'DELETE') {
    const planId = uuid(planMatch[1], 'planId');
    await sb(env, `userflex_plans?id=eq.${planId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await audit(env, request, 'admin', admin.userId, 'plan.delete', 'plan', planId);
    return json({ ok: true });
  }

  if (path === '/api/assignments' && method === 'POST') {
    const body = await bodyJson(request);
    const clientId = uuid(body.clientId, 'clientId');
    const profileId = uuid(body.profileId, 'profileId');
    const proxyId = body.proxyId ? uuid(body.proxyId, 'proxyId') : null;
    const enabled = body.enabled !== false;
    if (enabled) await requirePlanAllowsAssignment(env, clientId, profileId);
    const result = await sb(env, 'rpc/userflex_upsert_assignment', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: clientId,
        p_profile_id: profileId,
        p_proxy_id: proxyId,
        p_enabled: enabled,
      }),
    });
    const id = String(Array.isArray(result) ? result[0] : result);
    await audit(env, request, 'admin', admin.userId, 'assignment.upsert', 'assignment', id, {
      clientId,
      profileId,
      proxyAssigned: Boolean(proxyId),
      enabled,
    });
    return json(await assignmentResponse(env, id), 201);
  }

  const assignmentMatch = path.match(/^\/api\/assignments\/([0-9a-f-]{36})$/i);
  if (assignmentMatch && method === 'PATCH') {
    const assignmentId = uuid(assignmentMatch[1], 'assignmentId');
    const existingRows = await sb(
      env,
      `userflex_assignments?select=id,client_id,profile_id,proxy_id,enabled&id=eq.${assignmentId}&limit=1`,
    );
    const existing = existingRows?.[0];
    if (!existing) throw new HttpError(404, 'ASSIGNMENT_NOT_FOUND');
    const body = await bodyJson(request);
    const proxyId = body.proxyId === undefined
      ? existing.proxy_id
      : body.proxyId
        ? uuid(body.proxyId, 'proxyId')
        : null;
    const enabled = body.enabled === undefined ? existing.enabled === true : Boolean(body.enabled);
    if (enabled) await requirePlanAllowsAssignment(env, existing.client_id, existing.profile_id);
    const result = await sb(env, 'rpc/userflex_upsert_assignment', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: existing.client_id,
        p_profile_id: existing.profile_id,
        p_proxy_id: proxyId,
        p_enabled: enabled,
      }),
    });
    const id = String(Array.isArray(result) ? result[0] : result);
    await audit(env, request, 'admin', admin.userId, 'assignment.update', 'assignment', id, {
      proxyAssigned: Boolean(proxyId),
      enabled,
    });
    return json(await assignmentResponse(env, id));
  }

  return null;
}
