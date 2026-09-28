import { AdminIdentity } from './auth';
import { touchClientsConfig } from './client-revalidation';
import {
  Env,
  HttpError,
  audit,
  bodyJson,
  db,
  json,
  optional,
  text,
  uuid,
} from './core';

type ContentRuleScope = 'global' | 'selective';
type ContentRuleAction = 'hide';

function scopeValue(value: unknown): ContentRuleScope {
  if (value === undefined || value === null || value === '') return 'selective';
  if (value !== 'global' && value !== 'selective') {
    throw new HttpError(400, 'CONTENT_RULE_SCOPE_INVALID', 'El alcance de la regla no es válido.');
  }
  return value;
}

function actionValue(value: unknown): ContentRuleAction {
  if (value === undefined || value === null || value === '') return 'hide';
  if (value !== 'hide') {
    throw new HttpError(400, 'CONTENT_RULE_ACTION_INVALID', 'La acción de la regla no es válida.');
  }
  return value;
}

function domainValue(value: unknown): string {
  const raw = text(value, 'domain', 255).toLowerCase();
  if (raw === '*') return '*';

  let host = raw;
  if (/^https?:\/\//i.test(raw)) {
    try { host = new URL(raw).hostname.toLowerCase(); } catch {
      throw new HttpError(400, 'CONTENT_RULE_DOMAIN_INVALID', 'Ingresa un dominio válido.');
    }
  }
  host = host.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
  if (!host || host.includes('/') || host.includes(':') || /\s/.test(host)) {
    throw new HttpError(400, 'CONTENT_RULE_DOMAIN_INVALID', 'Ingresa solo el dominio, por ejemplo digen.ai.');
  }
  if (!/^[a-z0-9.-]+$/i.test(host) || host.startsWith('-') || host.endsWith('-') || host.includes('..')) {
    throw new HttpError(400, 'CONTENT_RULE_DOMAIN_INVALID', 'El dominio de la regla no es válido.');
  }
  return host;
}

function selectorValue(value: unknown): string {
  const selector = text(value, 'selector', 1000);
  if (selector.includes('\0') || selector.includes('\n') || selector.includes('\r')) {
    throw new HttpError(400, 'CONTENT_RULE_SELECTOR_INVALID', 'El selector CSS no es válido.');
  }
  return selector;
}

async function touchAllClients(env: Env): Promise<void> {
  const rows = await db(env, 'userflex_clients?select=id');
  await touchClientsConfig(env, (rows || []).map((row: any) => String(row.id || '')).filter(Boolean));
}

function publicRule(row: any) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    description: row.description ? String(row.description) : null,
    domain: String(row.domain || ''),
    selector: String(row.selector || ''),
    action: 'hide' as const,
    scope: row.scope === 'global' ? 'global' as const : 'selective' as const,
    enabled: row.enabled === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function managedContentRulesForProfiles(
  env: Env,
  profileIds: string[],
): Promise<Map<string, any[]>> {
  const ids = [...new Set(profileIds.map((value) => String(value || '')).filter(Boolean))];
  const result = new Map<string, any[]>(ids.map((id) => [id, []]));
  if (!ids.length) return result;

  const [rules, memberships] = await Promise.all([
    db(
      env,
      'userflex_content_rules?select=id,name,domain,selector,action,scope,enabled,updated_at&enabled=eq.true&order=created_at.asc',
    ).catch(() => []),
    db(
      env,
      `userflex_profile_content_rules?select=profile_id,rule_id&profile_id=in.(${ids.join(',')})`,
    ).catch(() => []),
  ]);

  const membershipMap = new Map<string, Set<string>>();
  for (const row of memberships || []) {
    const profileId = String(row.profile_id || '');
    if (!membershipMap.has(profileId)) membershipMap.set(profileId, new Set());
    membershipMap.get(profileId)?.add(String(row.rule_id || ''));
  }

  for (const profileId of ids) {
    const assigned = membershipMap.get(profileId) || new Set<string>();
    const applicable = (rules || [])
      .filter((row: any) => row.scope === 'global' || assigned.has(String(row.id)))
      .slice(0, 150)
      .map((row: any) => ({
        id: String(row.id),
        name: String(row.name || ''),
        domain: String(row.domain || '').toLowerCase(),
        selector: String(row.selector || '').slice(0, 1000),
        action: 'hide',
        revision: row.updated_at || null,
      }));
    result.set(profileId, applicable);
  }

  return result;
}

export async function adminContentRuleRoutes(
  request: Request,
  env: Env,
  admin: AdminIdentity,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/content-rules' && method === 'GET') {
    const rows = await db(
      env,
      'userflex_content_rules?select=id,name,description,domain,selector,action,scope,enabled,created_at,updated_at&order=created_at.desc',
    );
    return json((rows || []).map(publicRule));
  }

  if (path === '/api/content-rule-memberships' && method === 'GET') {
    return json(await db(
      env,
      'userflex_profile_content_rules?select=profile_id,rule_id,created_at&order=created_at.asc',
    ));
  }

  if (path === '/api/content-rules' && method === 'POST') {
    const body = await bodyJson(request);
    const row = {
      name: text(body.name, 'name', 120),
      description: optional(body.description, 1000),
      domain: domainValue(body.domain),
      selector: selectorValue(body.selector),
      action: actionValue(body.action),
      scope: scopeValue(body.scope),
      enabled: body.enabled !== false,
      updated_at: new Date().toISOString(),
    };
    const rows = await db(env, 'userflex_content_rules', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    const created = rows?.[0];
    if (!created) throw new HttpError(502, 'CONTENT_RULE_CREATE_FAILED');
    await touchAllClients(env);
    await audit(env, request, 'admin', admin.userId, 'content_rule.create', 'content_rule', created.id, {
      domain: created.domain,
      scope: created.scope,
    });
    return json(publicRule(created), 201);
  }

  const ruleMatch = path.match(/^\/api\/content-rules\/([0-9a-f-]{36})$/i);
  if (ruleMatch && method === 'PATCH') {
    const ruleId = uuid(ruleMatch[1], 'ruleId');
    const body = await bodyJson(request);
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = text(body.name, 'name', 120);
    if (body.description !== undefined) patch.description = optional(body.description, 1000);
    if (body.domain !== undefined) patch.domain = domainValue(body.domain);
    if (body.selector !== undefined) patch.selector = selectorValue(body.selector);
    if (body.action !== undefined) patch.action = actionValue(body.action);
    if (body.scope !== undefined) patch.scope = scopeValue(body.scope);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

    const rows = await db(env, `userflex_content_rules?id=eq.${ruleId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!rows?.[0]) throw new HttpError(404, 'CONTENT_RULE_NOT_FOUND', 'La regla no existe.');
    if (rows[0].scope === 'global') {
      await db(env, `userflex_profile_content_rules?rule_id=eq.${ruleId}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
    await touchAllClients(env);
    await audit(env, request, 'admin', admin.userId, 'content_rule.update', 'content_rule', ruleId, {
      enabled: rows[0].enabled === true,
      scope: rows[0].scope,
    });
    return json(publicRule(rows[0]));
  }

  if (ruleMatch && method === 'DELETE') {
    const ruleId = uuid(ruleMatch[1], 'ruleId');
    await db(env, `userflex_content_rules?id=eq.${ruleId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await touchAllClients(env);
    await audit(env, request, 'admin', admin.userId, 'content_rule.delete', 'content_rule', ruleId);
    return json({ ok: true });
  }

  const membershipMatch = path.match(/^\/api\/content-rules\/([0-9a-f-]{36})\/profiles$/i);
  if (membershipMatch && method === 'POST') {
    const ruleId = uuid(membershipMatch[1], 'ruleId');
    const body = await bodyJson(request);
    const profileIds = Array.isArray(body.profileIds)
      ? [...new Set(body.profileIds.map((value: unknown) => uuid(value, 'profileId')))].slice(0, 500)
      : [];

    const rules = await db(
      env,
      `userflex_content_rules?select=id,scope&id=eq.${ruleId}&limit=1`,
    );
    const rule = rules?.[0];
    if (!rule) throw new HttpError(404, 'CONTENT_RULE_NOT_FOUND', 'La regla no existe.');

    await db(env, `userflex_profile_content_rules?rule_id=eq.${ruleId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (rule.scope === 'selective' && profileIds.length) {
      await db(env, 'userflex_profile_content_rules', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(profileIds.map((profileId) => ({
          profile_id: profileId,
          rule_id: ruleId,
        }))),
      });
    }
    await touchAllClients(env);
    await audit(env, request, 'admin', admin.userId, 'content_rule.profiles.update', 'content_rule', ruleId, {
      profileCount: rule.scope === 'selective' ? profileIds.length : 0,
    });
    return json({
      ok: true,
      rule_id: ruleId,
      profile_ids: rule.scope === 'selective' ? profileIds : [],
    });
  }

  return null;
}
