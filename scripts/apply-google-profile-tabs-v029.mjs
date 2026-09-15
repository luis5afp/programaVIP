import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(path, 'utf8');
}

async function write(path, content) {
  await fs.writeFile(path, content, 'utf8');
}

function replaceExact(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing marker: ${label}`);
  return content.replace(from, to);
}

function replaceAllExact(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing marker: ${label}`);
  return content.split(from).join(to);
}

// Client version + visible version.
{
  const path = 'client-app/package.json';
  let s = await read(path);
  s = replaceExact(s, '"version": "0.2.28"', '"version": "0.2.29"', 'client version');
  await write(path, s);
}
{
  const path = 'client-app/index.html';
  let s = await read(path);
  s = replaceAllExact(s, 'v0.2.28', 'v0.2.29', 'visible client version');
  await write(path, s);
}

// Detached profile shell: direct click remains the normal profile tab; hover exposes a compact menu.
{
  const path = 'client-app/profile-window.html';
  let s = await read(path);
  s = replaceExact(
    s,
    '      <button id="new-page-button" class="new-page-button" type="button" title="Nueva pestaña del perfil" aria-label="Nueva pestaña del perfil">+</button>',
    `      <div id="new-page-wrap" class="new-page-wrap">\n        <button id="new-page-button" class="new-page-button" type="button" aria-label="Nueva pestaña del perfil">+</button>\n        <div id="new-page-menu" class="new-page-menu" role="menu" aria-label="Opciones de nueva pestaña">\n          <button id="new-profile-page-option" class="new-page-menu-button" type="button" role="menuitem">Nueva pestaña del perfil</button>\n          <button id="google-page-option" class="new-page-menu-button google-option hidden" type="button" role="menuitem">Abrir Google</button>\n        </div>\n      </div>`,
    'new page menu html',
  );
  await write(path, s);
}
{
  const path = 'client-app/profile-window.css';
  let s = await read(path);
  s = replaceExact(
    s,
    `.profile-badge,\n.page-tabs,\n.page-tab,\n.page-close,\n.new-page-button { -webkit-app-region: no-drag; }`,
    `.profile-badge,\n.page-tabs,\n.page-tab,\n.page-close,\n.new-page-wrap,\n.new-page-button,\n.new-page-menu,\n.new-page-menu-button { -webkit-app-region: no-drag; }`,
    'profile shell no-drag selectors',
  );
  s = replaceExact(
    s,
    `.new-page-button:hover { background: #1a2230; border-color: #303b50; color: #fff; }`,
    `.new-page-button:hover { background: #1a2230; border-color: #303b50; color: #fff; }\n.new-page-wrap {\n  position: relative;\n  height: 34px;\n  margin-bottom: 3px;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n}\n.new-page-wrap .new-page-button { margin-bottom: 0; }\n.new-page-menu {\n  position: absolute;\n  top: 34px;\n  left: 0;\n  z-index: 50;\n  width: 188px;\n  padding: 3px;\n  border: 1px solid #313b4f;\n  border-radius: 9px;\n  background: #101722;\n  box-shadow: 0 10px 28px rgba(0,0,0,.42);\n  opacity: 0;\n  visibility: hidden;\n  transform: translateY(-3px);\n  transition: opacity .12s ease, transform .12s ease, visibility .12s;\n}\n.new-page-menu.open { opacity: 1; visibility: visible; transform: translateY(0); }\n.new-page-menu-button {\n  width: 100%;\n  height: 24px;\n  border: 0;\n  border-radius: 6px;\n  padding: 0 8px;\n  background: transparent;\n  color: #c7d0df;\n  cursor: pointer;\n  text-align: left;\n  font-size: 10px;\n  font-weight: 700;\n  white-space: nowrap;\n}\n.new-page-menu-button:hover { background: #1d2735; color: #fff; }\n.new-page-menu-button.google-option::before { content: 'G'; display: inline-grid; place-items: center; width: 16px; height: 16px; margin-right: 7px; border-radius: 50%; background: #fff; color: #4285f4; font-size: 9px; font-weight: 900; }`,
    'new page menu css',
  );
  await write(path, s);
}
{
  const path = 'client-app/profile-window-renderer.js';
  let s = await read(path);
  s = replaceExact(
    s,
    `const newPageButton = document.getElementById('new-page-button');`,
    `const newPageButton = document.getElementById('new-page-button');\nconst newPageWrap = document.getElementById('new-page-wrap');\nconst newPageMenu = document.getElementById('new-page-menu');\nconst newProfilePageOption = document.getElementById('new-profile-page-option');\nconst googlePageOption = document.getElementById('google-page-option');`,
    'profile menu element refs',
  );
  s = replaceExact(
    s,
    `let state = { profileId: null, profileLabel: 'Perfil', activePageId: null, pages: [], networkLabel: 'Aislado' };\nlet pagePointerDrag = null;\nlet queuedState = null;`,
    `let state = { profileId: null, profileLabel: 'Perfil', activePageId: null, pages: [], networkLabel: 'Aislado', allowExternalBrowsing: false };\nlet pagePointerDrag = null;\nlet queuedState = null;\nlet newPageHoverTimer = null;`,
    'profile state defaults',
  );
  s = replaceExact(
    s,
    `function render() {`,
    `function closeNewPageMenu() {\n  if (newPageHoverTimer) clearTimeout(newPageHoverTimer);\n  newPageHoverTimer = null;\n  newPageMenu.classList.remove('open');\n}\n\nfunction scheduleNewPageMenu() {\n  if (newPageHoverTimer) clearTimeout(newPageHoverTimer);\n  newPageHoverTimer = setTimeout(() => {\n    googlePageOption.classList.toggle('hidden', state.allowExternalBrowsing !== true);\n    newPageMenu.classList.add('open');\n  }, 420);\n}\n\nfunction render() {`,
    'profile menu functions',
  );
  s = replaceExact(
    s,
    `  networkState.textContent = state.networkLabel || 'Aislado';\n  document.title = \`userFLOW · \${state.profileLabel || 'Perfil'}\`;`,
    `  networkState.textContent = state.networkLabel || 'Aislado';\n  googlePageOption.classList.toggle('hidden', state.allowExternalBrowsing !== true);\n  document.title = \`userFLOW · \${state.profileLabel || 'Perfil'}\`;`,
    'render external browsing permission',
  );
  s = replaceExact(
    s,
    `newPageButton.addEventListener('click', () => void run('new-page'));`,
    `newPageButton.addEventListener('click', () => {\n  closeNewPageMenu();\n  void run('new-page');\n});\nnewPageWrap.addEventListener('mouseenter', scheduleNewPageMenu);\nnewPageWrap.addEventListener('mouseleave', closeNewPageMenu);\nnewProfilePageOption.addEventListener('click', (event) => {\n  event.stopPropagation();\n  closeNewPageMenu();\n  void run('new-page');\n});\ngooglePageOption.addEventListener('click', (event) => {\n  event.stopPropagation();\n  closeNewPageMenu();\n  if (state.allowExternalBrowsing === true) void run('open-google');\n});`,
    'profile menu interactions',
  );
  await write(path, s);
}

// Client main process: same profile partition, new Google page only when server-granted permission is present.
{
  const path = 'client-app/main.js';
  let s = await read(path);
  s = replaceExact(
    s,
    `const HEARTBEAT_MS = 12 * 60 * 60 * 1000;`,
    `const HEARTBEAT_MS = 12 * 60 * 60 * 1000;\nconst GOOGLE_URL = 'https://www.google.com/';`,
    'google url constant',
  );
  s = replaceExact(
    s,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n  };`,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n    allowExternalBrowsing: authMeta?.client?.allowExternalBrowsing === true,\n  };`,
    'detached permission state',
  );
  s = replaceExact(
    s,
    `  if (action === 'new-page') {\n    try {\n      const page = await createProfilePage(workspace, workspace.profile.url, true);\n      return { ok: true, pageId: page.id };\n    } catch (error) {\n      return { ok: false, error: serializeError(error) };\n    }\n  }`,
    `  if (action === 'new-page') {\n    try {\n      const page = await createProfilePage(workspace, workspace.profile.url, true);\n      return { ok: true, pageId: page.id };\n    } catch (error) {\n      return { ok: false, error: serializeError(error) };\n    }\n  }\n  if (action === 'open-google') {\n    if (authMeta?.client?.allowExternalBrowsing !== true) {\n      return { ok: false, error: serializeError(new UserflexError('La navegación web adicional no está habilitada para este cliente.', 'EXTERNAL_BROWSING_DISABLED', 403)) };\n    }\n    try {\n      const page = await createProfilePage(workspace, GOOGLE_URL, true);\n      return { ok: true, pageId: page.id };\n    } catch (error) {\n      return { ok: false, error: serializeError(error) };\n    }\n  }`,
    'open google action',
  );
  await write(path, s);
}

// Admin UI + types.
{
  const path = 'src/types.ts';
  let s = await read(path);
  s = replaceExact(s, `  status: ClientStatus;\n  created_at: string;`, `  status: ClientStatus;\n  allow_external_browsing: boolean;\n  created_at: string;`, 'client type permission');
  await write(path, s);
}
{
  const path = 'src/api.ts';
  let s = await read(path);
  s = replaceExact(
    s,
    `Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status'>>`,
    `Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status' | 'allow_external_browsing'>>`,
    'client api update type',
  );
  await write(path, s);
}
{
  const path = 'src/views/ClientsView.tsx';
  let s = await read(path);
  s = replaceExact(
    s,
    `        status: String(form.get('status')) as Client['status'],\n      });`,
    `        status: String(form.get('status')) as Client['status'],\n        allow_external_browsing: form.get('allowExternalBrowsing') === 'on',\n      });`,
    'save client permission',
  );
  s = replaceExact(
    s,
    `            <Field label="Estado">\n              <select className="select" name="status" defaultValue={editClient.status}>\n                <option value="active">Activo</option>\n                <option value="suspended">Suspendido</option>\n              </select>\n            </Field>`,
    `            <Field label="Estado">\n              <select className="select" name="status" defaultValue={editClient.status}>\n                <option value="active">Activo</option>\n                <option value="suspended">Suspendido</option>\n              </select>\n            </Field>\n            <Field label="Navegación adicional" className="span-2" help="Habilita la opción “Abrir Google” al mantener el cursor sobre + dentro de un perfil. La pestaña seguirá aislada dentro de ese mismo perfil.">\n              <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer' }}>\n                <input type="checkbox" name="allowExternalBrowsing" defaultChecked={editClient.allow_external_browsing === true} />\n                <span>Permitir navegación web (Google) para este cliente</span>\n              </label>\n            </Field>`,
    'client edit permission field',
  );
  await write(path, s);
}

// API/backend: persist permission and include it in client authorization payloads.
{
  const path = 'cloudflare/lib/admin.ts';
  let s = await read(path);
  s = replaceAllExact(
    s,
    `userflex_clients?select=id,name,email,phone,status,created_at,updated_at`,
    `userflex_clients?select=id,name,email,phone,status,allow_external_browsing,created_at,updated_at`,
    'admin client selects',
  );
  s = replaceExact(
    s,
    `    if (body.phone !== undefined) patch.phone = optional(body.phone, 40);\n    if (body.status !== undefined) {`,
    `    if (body.phone !== undefined) patch.phone = optional(body.phone, 40);\n    if (body.allow_external_browsing !== undefined) patch.allow_external_browsing = Boolean(body.allow_external_browsing);\n    if (body.status !== undefined) {`,
    'admin permission patch',
  );
  await write(path, s);
}
{
  const path = 'cloudflare/lib/auth.ts';
  let s = await read(path);
  s = replaceAllExact(
    s,
    `userflex_clients?select=id,name,email,status,updated_at`,
    `userflex_clients?select=id,name,email,status,allow_external_browsing,updated_at`,
    'auth client selects',
  );
  s = replaceExact(
    s,
    `client:{id:client.id,name:client.name,email:client.email,configRevision:client.updated_at}`,
    `client:{id:client.id,name:client.name,email:client.email,configRevision:client.updated_at,allowExternalBrowsing:client.allow_external_browsing===true}`,
    'login client payload',
  );
  await write(path, s);
}
{
  const path = 'cloudflare/lib/client.ts';
  let s = await read(path);
  s = replaceAllExact(
    s,
    `client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at },`,
    `client: { id: id.clientId, name: id.client.name, email: id.client.email, configRevision: id.client.updated_at, allowExternalBrowsing: id.client.allow_external_browsing === true },`,
    'client response permission payloads',
  );
  await write(path, s);
}
{
  const path = 'cloudflare/worker.ts';
  let s = await read(path);
  s = replaceExact(s, `const APP_VERSION = '1.2.3';`, `const APP_VERSION = '1.2.4';`, 'worker version');
  await write(path, s);
}

// Schema migration: opt-in and disabled for every existing/new client by default.
await fs.mkdir('supabase/migrations', { recursive: true });
await write(
  'supabase/migrations/20260915050000_userflex_client_external_browsing.sql',
  `alter table public.userflex_clients\n  add column if not exists allow_external_browsing boolean not null default false;\n\ncomment on column public.userflex_clients.allow_external_browsing is\n  'Allows the userFLOW client to offer an admin-controlled Google browsing tab inside isolated profile windows.';\n`,
);

console.log('Applied userFLOW v0.2.29 Google profile tab permission patch.');
