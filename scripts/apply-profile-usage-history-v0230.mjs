import fs from 'node:fs/promises';

async function read(path) { return fs.readFile(path, 'utf8'); }
async function write(path, content) { await fs.writeFile(path, content, 'utf8'); }
function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`Missing replacement target: ${label}`);
  return content.replace(search, replacement);
}

// Worker routing.
{
  const path = 'cloudflare/worker.ts';
  let s = await read(path);
  s = replaceOnce(
    s,
    "import { clientCatalog, clientHeartbeat, clientLaunch, clientLogout } from './lib/client';\n",
    "import { clientCatalog, clientHeartbeat, clientLaunch, clientLogout } from './lib/client';\nimport { adminProfileUsageRoutes, clientCloseProfileUsage } from './lib/profile-usage';\n",
    'worker profile usage import',
  );
  s = replaceOnce(s, "const APP_VERSION = '1.2.6';", "const APP_VERSION = '1.2.7';", 'worker version');
  s = replaceOnce(
    s,
    "    const launch = path.match(/^\\/api\\/client\\/profiles\\/([0-9a-f-]{36})\\/launch$/i);\n    if (launch && method === 'POST') return clientLaunch(request, env, identity, launch[1]);\n    throw new HttpError(404, 'NOT_FOUND');",
    "    const launch = path.match(/^\\/api\\/client\\/profiles\\/([0-9a-f-]{36})\\/launch$/i);\n    if (launch && method === 'POST') return clientLaunch(request, env, identity, launch[1]);\n    const usageClose = path.match(/^\\/api\\/client\\/profile-usage\\/([0-9a-f-]{36})\\/close$/i);\n    if (usageClose && method === 'POST') return clientCloseProfileUsage(request, env, identity, usageClose[1]);\n    throw new HttpError(404, 'NOT_FOUND');",
    'worker client close route',
  );
  s = replaceOnce(
    s,
    "  const profileProxyResponse = await profileProxyDefaultRoutes(request, env, admin);",
    "  const profileUsageResponse = await adminProfileUsageRoutes(request, env, admin);\n  if (profileUsageResponse) return profileUsageResponse;\n  const profileProxyResponse = await profileProxyDefaultRoutes(request, env, admin);",
    'worker admin history route',
  );
  await write(path, s);
}

// Client API usage session lifecycle.
{
  const path = 'cloudflare/lib/client.ts';
  let s = await read(path);
  s = replaceOnce(
    s,
    "import { managedSessionMaterial } from './profile-sessions';\n",
    "import { managedSessionMaterial } from './profile-sessions';\nimport { closeOpenProfileUsageForSession, openProfileUsage } from './profile-usage';\n",
    'client usage import',
  );
  s = replaceOnce(
    s,
    "  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {",
    "  const usage = await openProfileUsage(request, env, id, { id: profile.id, name: profile.name, url: profile.url });\n\n  await audit(env, request, 'client', id.clientId, 'profile.launch', 'profile', profileId, {",
    'client usage open',
  );
  s = replaceOnce(
    s,
    "    connection,\n    sessionDelivery,\n",
    "    connection,\n    sessionDelivery,\n    usage,\n",
    'client usage response',
  );
  s = replaceOnce(
    s,
    "export async function clientLogout(env: Env, id: ClientIdentity) {\n  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {",
    "export async function clientLogout(env: Env, id: ClientIdentity) {\n  await closeOpenProfileUsageForSession(env, id.sessionId, 'logout');\n  await sb(env, `userflex_client_sessions?id=eq.${id.sessionId}`, {",
    'client logout closes usage',
  );
  await write(path, s);
}

// Admin actions that invalidate access also close any live history sessions.
{
  const path = 'cloudflare/lib/admin.ts';
  let s = await read(path);
  s = replaceOnce(
    s,
    "import { touchClientConfig, touchProfileClients } from './client-revalidation';\n",
    "import { touchClientConfig, touchProfileClients } from './client-revalidation';\nimport { closeOpenProfileUsageForClient, closeOpenProfileUsageForDevice } from './profile-usage';\n",
    'admin usage import',
  );
  s = replaceOnce(
    s,
    "    await touchClientConfig(env, clientId);\n    await audit(env, request, 'admin', admin.userId, 'client.credentials.reset', 'client', clientId);",
    "    await closeOpenProfileUsageForClient(env, clientId, 'credentials_reset');\n    await touchClientConfig(env, clientId);\n    await audit(env, request, 'admin', admin.userId, 'client.credentials.reset', 'client', clientId);",
    'credentials reset close history',
  );
  s = replaceOnce(
    s,
    "    await touchClientConfig(env, clientId);\n    await audit(env, request, 'admin', admin.userId, 'client.subscription.update', 'client', clientId, { planId, expiresAt });",
    "    await closeOpenProfileUsageForClient(env, clientId, 'subscription_changed');\n    await touchClientConfig(env, clientId);\n    await audit(env, request, 'admin', admin.userId, 'client.subscription.update', 'client', clientId, { planId, expiresAt });",
    'subscription close history',
  );
  s = replaceOnce(
    s,
    "      await sb(env, `userflex_client_sessions?client_id=eq.${clientId}&revoked_at=is.null`, {\n        method: 'PATCH',\n        headers: { Prefer: 'return=minimal' },\n        body: JSON.stringify({ revoked_at: new Date().toISOString() }),\n      });\n    }\n    await audit(env, request, 'admin', admin.userId, 'client.update', 'client', clientId);",
    "      await sb(env, `userflex_client_sessions?client_id=eq.${clientId}&revoked_at=is.null`, {\n        method: 'PATCH',\n        headers: { Prefer: 'return=minimal' },\n        body: JSON.stringify({ revoked_at: new Date().toISOString() }),\n      });\n      await closeOpenProfileUsageForClient(env, clientId, 'client_suspended');\n    }\n    await audit(env, request, 'admin', admin.userId, 'client.update', 'client', clientId);",
    'suspend close history',
  );
  s = replaceOnce(
    s,
    "  if (clientMatch && method === 'DELETE') {\n    const clientId = uuid(clientMatch[1], 'clientId');\n    await sb(env, `userflex_clients?id=eq.${clientId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });",
    "  if (clientMatch && method === 'DELETE') {\n    const clientId = uuid(clientMatch[1], 'clientId');\n    await closeOpenProfileUsageForClient(env, clientId, 'client_deleted');\n    await sb(env, `userflex_clients?id=eq.${clientId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });",
    'delete close history',
  );
  s = replaceOnce(
    s,
    "    await sb(env, `userflex_client_sessions?device_id=eq.${device.id}&revoked_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });\n    await touchClientConfig(env, device.client_id);",
    "    await sb(env, `userflex_client_sessions?device_id=eq.${device.id}&revoked_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });\n    await closeOpenProfileUsageForDevice(env, device.id, 'device_revoked');\n    await touchClientConfig(env, device.client_id);",
    'device revoke close history',
  );
  await write(path, s);
}

// Admin TypeScript model.
{
  const path = 'src/types.ts';
  let s = await read(path);
  s = replaceOnce(
    s,
    "export interface AuditLog {",
    `export interface ProfileUsage {\n  id: string;\n  client_id: string | null;\n  device_id: string | null;\n  profile_id: string | null;\n  client_name: string;\n  client_email: string | null;\n  device_name: string | null;\n  device_os: string | null;\n  profile_name: string;\n  profile_url: string | null;\n  client_version: string | null;\n  ip: string | null;\n  opened_at: string;\n  closed_at: string | null;\n  close_reason: string | null;\n}\n\nexport interface AuditLog {`,
    'types profile usage',
  );
  s = replaceOnce(s, "  | 'devices'\n  | 'audit'", "  | 'devices'\n  | 'history'\n  | 'audit'", 'types history view');
  await write(path, s);
}

// Admin API client.
{
  const path = 'src/api.ts';
  let s = await read(path);
  s = replaceOnce(s, "  Plan,\n  Profile,", "  Plan,\n  Profile,\n  ProfileUsage,", 'api ProfileUsage import');
  s = replaceOnce(
    s,
    "  audit: {\n    list: () => request<AuditLog[]>('/api/audit?limit=200'),\n  },",
    "  profileUsage: {\n    list: () => request<ProfileUsage[]>('/api/profile-usage?limit=2000'),\n  },\n\n  audit: {\n    list: () => request<AuditLog[]>('/api/audit?limit=200'),\n  },",
    'api profile usage methods',
  );
  await write(path, s);
}

// App navigation and client history shortcut.
{
  const path = 'src/App.tsx';
  let s = await read(path);
  s = replaceOnce(s, "import { DevicesView } from './views/DevicesView';\n", "import { DevicesView } from './views/DevicesView';\nimport { HistoryView } from './views/HistoryView';\n", 'app history import');
  s = replaceOnce(s, "  const [view, setView] = useState<ViewKey>('dashboard');\n", "  const [view, setView] = useState<ViewKey>('dashboard');\n  const [historySearch, setHistorySearch] = useState('');\n", 'app history state');
  s = replaceOnce(
    s,
    "    case 'clients': content = <ClientsView />; break;",
    "    case 'clients': content = <ClientsView onHistory={(client) => { setHistorySearch(client.name); setView('history'); }} />; break;",
    'app client history shortcut',
  );
  s = replaceOnce(s, "    case 'devices': content = <DevicesView />; break;\n    case 'audit':", "    case 'devices': content = <DevicesView />; break;\n    case 'history': content = <HistoryView initialSearch={historySearch} />; break;\n    case 'audit':", 'app history view');
  s = replaceOnce(
    s,
    "  return <Layout session={session} view={view} onView={setView} onLogout={logout}>{content}</Layout>;",
    "  return <Layout session={session} view={view} onView={(next) => { if (next === 'history') setHistorySearch(''); setView(next); }} onLogout={logout}>{content}</Layout>;",
    'app history nav reset',
  );
  await write(path, s);
}

// Sidebar entry.
{
  const path = 'src/components/Layout.tsx';
  let s = await read(path);
  s = replaceOnce(s, "  Globe2,\n  Laptop,", "  Globe2,\n  History,\n  Laptop,", 'layout History icon import');
  s = replaceOnce(s, "  { id: 'devices', label: 'Dispositivos', icon: Laptop },\n  { id: 'audit'", "  { id: 'devices', label: 'Dispositivos', icon: Laptop },\n  { id: 'history', label: 'Historial', icon: History },\n  { id: 'audit'", 'layout history item');
  await write(path, s);
}

// Client list history button.
{
  const path = 'src/views/ClientsView.tsx';
  let s = await read(path);
  s = replaceOnce(s, "import { CalendarClock, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';", "import { CalendarClock, History, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';", 'clients History icon');
  s = replaceOnce(s, "export function ClientsView() {", "export function ClientsView({ onHistory }: { onHistory: (client: Client) => void }) {", 'clients prop');
  s = replaceOnce(
    s,
    "                          <button className=\"button secondary small\" onClick={() => setSubscriptionClient(client)}>\n                            <CalendarClock size={12} />\n                            Plan\n                          </button>",
    "                          <button className=\"button secondary small\" onClick={() => setSubscriptionClient(client)}>\n                            <CalendarClock size={12} />\n                            Plan\n                          </button>\n                          <button className=\"button secondary small\" onClick={() => onHistory(client)}>\n                            <History size={12} />\n                            Historial\n                          </button>",
    'clients history button',
  );
  await write(path, s);
}

// Electron usage close reporting.
{
  const path = 'client-app/main.js';
  let s = await read(path);
  s = replaceOnce(
    s,
    "let profileDragMonitor = null;\n",
    "let profileDragMonitor = null;\nconst pendingUsageCloseRequests = new Set();\nlet quitAfterUsageFlush = false;\n",
    'main usage globals',
  );
  s = replaceOnce(
    s,
    "function authError(error) {",
    `function closeWorkspaceUsage(workspace, reason = 'profile_closed') {\n  if (!workspace?.usageId || workspace.usageClosed === true) return Promise.resolve(true);\n  if (workspace.usageClosePromise) return workspace.usageClosePromise;\n  const request = apiRequest(\`/api/client/profile-usage/\${workspace.usageId}/close\`, {\n    method: 'POST',\n    body: { reason },\n    timeout: 8_000,\n  })\n    .then(() => { workspace.usageClosed = true; return true; })\n    .catch(() => false)\n    .finally(() => {\n      pendingUsageCloseRequests.delete(request);\n      workspace.usageClosePromise = null;\n    });\n  workspace.usageClosePromise = request;\n  pendingUsageCloseRequests.add(request);\n  return request;\n}\n\nasync function flushUsageCloseRequests(timeoutMs = 1800) {\n  const pending = Array.from(pendingUsageCloseRequests);\n  if (!pending.length) return;\n  await Promise.race([\n    Promise.allSettled(pending),\n    new Promise((resolve) => setTimeout(resolve, timeoutMs)),\n  ]);\n}\n\nfunction authError(error) {`,
    'main usage helper insertion',
  );
  s = replaceOnce(
    s,
    "function cleanupWorkspace(workspace) {\n  if (!workspace || workspace.cleaned) return;\n  workspace.cleaned = true;",
    "function cleanupWorkspace(workspace, reason = 'profile_closed') {\n  if (!workspace || workspace.cleaned) return;\n  workspace.cleaned = true;\n  void closeWorkspaceUsage(workspace, reason);",
    'main cleanup usage',
  );
  s = replaceOnce(
    s,
    "  const launch = await apiRequest(`/api/client/profiles/${profileId}/launch`, { method: 'POST' });",
    "  const launch = await apiRequest(`/api/client/profiles/${profileId}/launch`, {\n    method: 'POST',\n    headers: {\n      'X-Userflow-Profile-Usage': '1',\n      'X-Userflow-Client-Version': app.getVersion(),\n    },\n  });",
    'main launch tracking header',
  );
  s = replaceOnce(
    s,
    "    closing: false,\n    cleaned: false,\n  };",
    "    closing: false,\n    cleaned: false,\n    usageId: launch?.usage?.id || null,\n    usageClosed: false,\n    usageClosePromise: null,\n  };",
    'main workspace usage fields',
  );
  s = replaceOnce(
    s,
    "  } catch (error) {\n    cleanupWorkspace(workspace);\n    throw error;\n  }\n}\n\nipcMain.handle('userflex:bootstrap'",
    "  } catch (error) {\n    cleanupWorkspace(workspace, 'launch_failed');\n    throw error;\n  }\n}\n\nipcMain.handle('userflex:bootstrap'",
    'main launch failure close',
  );
  s = replaceOnce(
    s,
    "app.whenReady().then(async () => {",
    `app.on('before-quit', (event) => {\n  if (quitAfterUsageFlush) return;\n  for (const workspace of profileTabs.values()) void closeWorkspaceUsage(workspace, 'app_exit');\n  if (pendingUsageCloseRequests.size === 0) return;\n  event.preventDefault();\n  quitAfterUsageFlush = true;\n  void flushUsageCloseRequests().finally(() => app.quit());\n});\n\napp.whenReady().then(async () => {`,
    'main before quit flush',
  );
  await write(path, s);
}

// Client version bump.
{
  const path = 'client-app/package.json';
  let s = await read(path);
  s = replaceOnce(s, '"version": "0.2.29"', '"version": "0.2.30"', 'package version');
  await write(path, s);
}
{
  const path = 'client-app/index.html';
  let s = await read(path);
  if (!s.includes('v0.2.29')) throw new Error('Missing v0.2.29 in client index');
  s = s.replaceAll('v0.2.29', 'v0.2.30');
  await write(path, s);
}

console.log('Applied profile usage history v0.2.30 changes.');
