import type { AdminIdentity } from './auth';
import { Env, HttpError, audit, bodyJson, json, optional, sb, text, uuid } from './core';

type AdminRole = 'owner' | 'admin';

type AdminProfile = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: AdminRole;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CredentialUser = {
  id: string;
  username: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

function requireOwner(admin: AdminIdentity) {
  if (admin.role !== 'owner') {
    throw new HttpError(403, 'OWNER_REQUIRED', 'Sólo un Propietario puede administrar accesos al panel.');
  }
}

function parseRole(value: unknown): AdminRole {
  if (value === 'owner' || value === 'admin') return value;
  throw new HttpError(400, 'INVALID_ROLE', 'El rol seleccionado no es válido.');
}

function serialize(profile: AdminProfile, user: CredentialUser) {
  return {
    id: profile.user_id,
    username: user.username,
    display_name: profile.display_name,
    email: profile.email,
    role: profile.role,
    enabled: user.enabled === true,
    last_login_at: profile.last_login_at,
    created_at: profile.created_at || user.created_at,
    updated_at: profile.updated_at || user.updated_at,
  };
}

async function getProfile(env: Env, userId: string): Promise<AdminProfile | null> {
  const rows = await sb(
    env,
    `userflex_admin_profiles?select=user_id,display_name,email,role,last_login_at,created_by,created_at,updated_at&user_id=eq.${userId}&limit=1`,
  );
  return rows?.[0] || null;
}

async function getCredentialUser(env: Env, userId: string): Promise<CredentialUser | null> {
  const rows = await sb(
    env,
    `vsixteen_users?select=id,username,enabled,created_at,updated_at&id=eq.${userId}&limit=1`,
  );
  return rows?.[0] || null;
}

async function getAdminRecord(env: Env, userId: string) {
  const [profile, user] = await Promise.all([getProfile(env, userId), getCredentialUser(env, userId)]);
  if (!profile || !user) throw new HttpError(404, 'ADMIN_NOT_FOUND', 'El administrador no existe.');
  return { profile, user };
}

async function listRecords(env: Env) {
  const profiles: AdminProfile[] = await sb(
    env,
    'userflex_admin_profiles?select=user_id,display_name,email,role,last_login_at,created_by,created_at,updated_at&order=created_at.asc',
  );
  if (!profiles?.length) return [];
  const ids = profiles.map((profile) => profile.user_id).join(',');
  const users: CredentialUser[] = await sb(
    env,
    `vsixteen_users?select=id,username,enabled,created_at,updated_at&id=in.(${ids})`,
  );
  const byId = new Map(users.map((user) => [user.id, user]));
  return profiles.flatMap((profile) => {
    const user = byId.get(profile.user_id);
    return user ? [serialize(profile, user)] : [];
  });
}

async function activeOwnerCount(env: Env) {
  const profiles: AdminProfile[] = await sb(
    env,
    'userflex_admin_profiles?select=user_id,display_name,email,role,last_login_at,created_by,created_at,updated_at&role=eq.owner',
  );
  if (!profiles?.length) return 0;
  const ids = profiles.map((profile) => profile.user_id).join(',');
  const users: Array<{ id: string; enabled: boolean }> = await sb(
    env,
    `vsixteen_users?select=id,enabled&id=in.(${ids})&enabled=eq.true`,
  );
  return users?.length || 0;
}

async function revokeOtherSessions(env: Env, userId: string, keepSessionId?: string) {
  const suffix = keepSessionId ? `&id=neq.${keepSessionId}` : '';
  await sb(env, `vsixteen_login_sessions?user_id=eq.${userId}&revoked_at=is.null${suffix}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
}

async function createAdmin(request: Request, env: Env, admin: AdminIdentity) {
  requireOwner(admin);
  const body = await bodyJson(request, 16384);
  const username = text(body.username, 'Usuario', 120);
  const displayName = text(body.displayName, 'Nombre', 120);
  const email = optional(body.email, 180);
  const role = parseRole(body.role);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10 || password.length > 256) {
    throw new HttpError(400, 'WEAK_PASSWORD', 'La contraseña debe tener al menos 10 caracteres.');
  }

  const created = await sb(env, 'rpc/userflex_create_admin_user', {
    method: 'POST',
    body: JSON.stringify({
      p_username: username,
      p_password: password,
      p_display_name: displayName,
      p_email: email,
      p_role: role,
      p_created_by: admin.userId,
    }),
  });
  const userId = typeof created === 'string' ? created : Array.isArray(created) ? created[0] : created;
  if (!userId) throw new HttpError(502, 'ADMIN_CREATE_FAILED');
  await audit(env, request, 'admin', admin.userId, 'admin_user.created', 'admin_user', userId, {
    username,
    role,
  });
  const record = await getAdminRecord(env, userId);
  return json(serialize(record.profile, record.user), 201);
}

async function updateAdmin(request: Request, env: Env, admin: AdminIdentity, userId: string) {
  requireOwner(admin);
  const current = await getAdminRecord(env, userId);
  const body = await bodyJson(request, 16384);
  const profilePatch: Record<string, unknown> = {};
  const userPatch: Record<string, unknown> = {};

  if (body.displayName !== undefined) profilePatch.display_name = text(body.displayName, 'Nombre', 120);
  if (body.email !== undefined) profilePatch.email = optional(body.email, 180);
  if (body.role !== undefined) profilePatch.role = parseRole(body.role);
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Estado no válido.');
    userPatch.enabled = body.enabled;
  }

  const nextRole = (profilePatch.role as AdminRole | undefined) || current.profile.role;
  const nextEnabled = typeof userPatch.enabled === 'boolean' ? (userPatch.enabled as boolean) : current.user.enabled;
  const removesActiveOwner = current.profile.role === 'owner' && current.user.enabled && (nextRole !== 'owner' || !nextEnabled);
  if (removesActiveOwner && (await activeOwnerCount(env)) <= 1) {
    throw new HttpError(409, 'LAST_OWNER', 'Debe existir al menos un Propietario activo.');
  }
  if (userId === admin.userId && nextEnabled === false) {
    throw new HttpError(409, 'CANNOT_DISABLE_SELF', 'No puedes suspender tu propia cuenta mientras la estás usando.');
  }

  const stamp = new Date().toISOString();
  if (Object.keys(profilePatch).length) {
    profilePatch.updated_at = stamp;
    await sb(env, `userflex_admin_profiles?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(profilePatch),
    });
  }
  if (Object.keys(userPatch).length) {
    userPatch.updated_at = stamp;
    await sb(env, `vsixteen_users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(userPatch),
    });
    if (userPatch.enabled === false) await revokeOtherSessions(env, userId);
  }

  await audit(env, request, 'admin', admin.userId, 'admin_user.updated', 'admin_user', userId, {
    fields: Object.keys({ ...profilePatch, ...userPatch }).filter((field) => field !== 'updated_at'),
  });
  const record = await getAdminRecord(env, userId);
  return json(serialize(record.profile, record.user));
}

async function setAdminPassword(request: Request, env: Env, admin: AdminIdentity, userId: string) {
  requireOwner(admin);
  await getAdminRecord(env, userId);
  const body = await bodyJson(request, 8192);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10 || password.length > 256) {
    throw new HttpError(400, 'WEAK_PASSWORD', 'La contraseña debe tener al menos 10 caracteres.');
  }
  await sb(env, 'rpc/userflex_set_admin_password', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_password: password }),
  });
  await revokeOtherSessions(env, userId, userId === admin.userId ? admin.sessionId : undefined);
  await audit(env, request, 'admin', admin.userId, 'admin_user.password_changed', 'admin_user', userId);
  return json({ ok: true });
}

async function deleteAdmin(request: Request, env: Env, admin: AdminIdentity, userId: string) {
  requireOwner(admin);
  if (userId === admin.userId) {
    throw new HttpError(409, 'CANNOT_DELETE_SELF', 'No puedes eliminar la cuenta con la que has iniciado sesión.');
  }
  const current = await getAdminRecord(env, userId);
  if (current.profile.role === 'owner' && current.user.enabled && (await activeOwnerCount(env)) <= 1) {
    throw new HttpError(409, 'LAST_OWNER', 'Debe existir al menos un Propietario activo.');
  }
  await audit(env, request, 'admin', admin.userId, 'admin_user.deleted', 'admin_user', userId, {
    username: current.user.username,
    role: current.profile.role,
  });
  await sb(env, `vsixteen_users?id=eq.${userId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return json({ ok: true });
}

export async function adminUserRoutes(request: Request, env: Env, admin: AdminIdentity): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/admin-users' && method === 'GET') {
    requireOwner(admin);
    return json(await listRecords(env));
  }
  if (path === '/api/admin-users' && method === 'POST') return createAdmin(request, env, admin);

  const passwordMatch = path.match(/^\/api\/admin-users\/([0-9a-f-]{36})\/password$/i);
  if (passwordMatch && method === 'POST') {
    return setAdminPassword(request, env, admin, uuid(passwordMatch[1], 'Administrador'));
  }

  const match = path.match(/^\/api\/admin-users\/([0-9a-f-]{36})$/i);
  if (match && method === 'PATCH') return updateAdmin(request, env, admin, uuid(match[1], 'Administrador'));
  if (match && method === 'DELETE') return deleteAdmin(request, env, admin, uuid(match[1], 'Administrador'));

  return null;
}
