import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', 'main.js');
const marker = '// userFLOW profile security hardening v1';
let source = await fs.readFile(mainPath, 'utf8');
source = source.replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  source = source.replace(
    "import { app, BrowserWindow, WebContentsView, ipcMain, safeStorage, screen } from 'electron';",
    "import { app, BrowserWindow, WebContentsView, ipcMain, safeStorage, screen, session } from 'electron';",
  );
  source = source.replace(
    "import crypto from 'node:crypto';",
    "import crypto from 'node:crypto';\nimport { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';",
  );
  source = source.replace(
    "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
    "const execFileAsync = promisify(execFile);\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));",
  );

  const securityHelpers = `${marker}\nlet profileRegistryCache = null;\nlet profileRegistryWrite = Promise.resolve();\n\nfunction profileRegistryPath() {\n  return path.join(app.getPath('userData'), 'profile-registry.json');\n}\n\nfunction profilePartitionName(clientId, profileId) {\n  return \`persist:userflex-client-${'${clientId}'}-${'${profileId}'}\`;\n}\n\nfunction validProfileId(value) {\n  return /^[0-9a-f-]{36}$/i.test(String(value || ''));\n}\n\nasync function readProfileRegistry() {\n  if (profileRegistryCache) return profileRegistryCache;\n  try {\n    const parsed = JSON.parse(await fs.readFile(profileRegistryPath(), 'utf8'));\n    profileRegistryCache = parsed && typeof parsed === 'object' ? parsed : { clients: {} };\n  } catch {\n    profileRegistryCache = { clients: {} };\n  }\n  if (!profileRegistryCache.clients || typeof profileRegistryCache.clients !== 'object') profileRegistryCache.clients = {};\n  return profileRegistryCache;\n}\n\nasync function writeProfileRegistry() {\n  const state = await readProfileRegistry();\n  profileRegistryWrite = profileRegistryWrite.then(async () => {\n    const file = profileRegistryPath();\n    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });\n    await fs.writeFile(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });\n    await fs.chmod(file, 0o600).catch(() => null);\n  }).catch(() => null);\n  await profileRegistryWrite;\n}\n\nasync function legacyManagedProfileIds(clientId) {\n  try {\n    const state = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'profile-session-state.json'), 'utf8'));\n    const prefix = \`${'${clientId}'}:\`;\n    return Object.keys(state || {})\n      .filter((key) => key.startsWith(prefix))\n      .map((key) => key.slice(prefix.length))\n      .filter(validProfileId);\n  } catch {\n    return [];\n  }\n}\n\nasync function knownLocalProfileIds(clientId) {\n  const registry = await readProfileRegistry();\n  const registered = Array.isArray(registry.clients?.[clientId]?.profileIds)\n    ? registry.clients[clientId].profileIds.filter(validProfileId)\n    : [];\n  const legacy = await legacyManagedProfileIds(clientId);\n  const open = authMeta?.client?.id === clientId ? Array.from(profileTabs.keys()).filter(validProfileId) : [];\n  return Array.from(new Set([...registered, ...legacy, ...open]));\n}\n\nasync function clearPersistentProfileData(clientId, profileId) {\n  if (!clientId || !validProfileId(profileId)) return;\n  if (authMeta?.client?.id === clientId && profileTabs.has(profileId)) {\n    try { closeProfileTab(profileId); } catch {}\n  }\n  const browserSession = session.fromPartition(profilePartitionName(clientId, profileId));\n  try { await browserSession.closeAllConnections(); } catch {}\n  try { await browserSession.clearCache(); } catch {}\n  try { await browserSession.clearStorageData(); } catch {}\n  try { browserSession.flushStorageData(); } catch {}\n}\n\nasync function rememberAuthorizedProfiles(clientId, profileIds) {\n  const registry = await readProfileRegistry();\n  registry.clients[clientId] = {\n    profileIds: Array.from(new Set(profileIds.filter(validProfileId))),\n    updatedAt: Date.now(),\n  };\n  await writeProfileRegistry();\n}\n\nasync function reconcileAuthorizedProfiles(catalogPayload) {\n  const clientId = authMeta?.client?.id;\n  if (!clientId || !Array.isArray(catalogPayload?.profiles)) return;\n  const authorized = catalogPayload.profiles.map((profile) => profile?.id).filter(validProfileId);\n  const authorizedSet = new Set(authorized);\n  const known = await knownLocalProfileIds(clientId);\n  const revoked = known.filter((profileId) => !authorizedSet.has(profileId));\n  for (const profileId of revoked) await clearPersistentProfileData(clientId, profileId);\n  await rememberAuthorizedProfiles(clientId, authorized);\n}\n\nasync function clearAllClientProfileData(clientId) {\n  if (!clientId) return;\n  const profileIds = await knownLocalProfileIds(clientId);\n  for (const profileId of profileIds) await clearPersistentProfileData(clientId, profileId);\n  const registry = await readProfileRegistry();\n  delete registry.clients[clientId];\n  await writeProfileRegistry();\n}\n\nasync function hardenUserDataPermissions() {\n  const userData = app.getPath('userData');\n  await fs.mkdir(userData, { recursive: true, mode: 0o700 });\n  await fs.chmod(userData, 0o700).catch(() => null);\n  if (process.platform !== 'win32') return;\n  try {\n    const result = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 });\n    const sid = String(result?.stdout || '').match(/\"[^\"]*\",\"(S-[^\"]+)\"/i)?.[1];\n    if (!sid) return;\n    await execFileAsync('icacls.exe', [\n      userData,\n      '/inheritance:r',\n      '/grant:r', \`*${'${sid}'}:(OI)(CI)F\`,\n      '/grant:r', '*S-1-5-18:(OI)(CI)F',\n      '/T', '/C', '/Q',\n    ], { windowsHide: true, timeout: 20000 });\n  } catch {\n    // Keep running with the OS/default ACL if Windows refuses an ACL update.\n  }\n}\n\n`;

  const deviceAnchor = 'async function getDeviceKey() {';
  const deviceIndex = source.indexOf(deviceAnchor);
  if (deviceIndex < 0) throw new Error('Could not locate getDeviceKey() in main.js');
  source = source.slice(0, deviceIndex) + securityHelpers + source.slice(deviceIndex);

  const syncNeedle = "  if (freshCatalog) mergeValidationMeta(freshCatalog);\n  if (accessToken && authMeta) await saveAuth(accessToken, authMeta).catch(() => null);";
  const syncReplacement = "  if (freshCatalog) {\n    mergeValidationMeta(freshCatalog);\n    await reconcileAuthorizedProfiles(freshCatalog).catch(() => null);\n  }\n  if (accessToken && authMeta) await saveAuth(accessToken, authMeta).catch(() => null);";
  if (!source.includes(syncNeedle)) throw new Error('Could not locate syncClientConfiguration catalog merge in main.js');
  source = source.replace(syncNeedle, syncReplacement);

  const oldReturnToLogin = `async function returnToLogin() {\n  await clearAuth();\n  const loginWindow = createMainWindow();\n  loginWindow.show();\n  loginWindow.focus();\n  closePrivateBrowser();\n}`;
  const newReturnToLogin = `async function returnToLogin() {\n  const clientId = authMeta?.client?.id || null;\n  closePrivateBrowser();\n  if (clientId) await clearAllClientProfileData(clientId).catch(() => null);\n  await clearAuth();\n  const loginWindow = createMainWindow();\n  loginWindow.show();\n  loginWindow.focus();\n}`;
  if (!source.includes(oldReturnToLogin)) throw new Error('Could not locate returnToLogin() in main.js');
  source = source.replace(oldReturnToLogin, newReturnToLogin);

  const restoreNeedle = "      await restoreManagedSession(firstPage.view.webContents, browserSession, profile, delivery);\n    } else {";
  const restoreReplacement = "      await restoreManagedSession(firstPage.view.webContents, browserSession, profile, delivery);\n      if (delivery && typeof delivery === 'object') delivery.material = null;\n    } else {";
  if (!source.includes(restoreNeedle)) throw new Error('Could not locate managed session restore in openProfile()');
  source = source.replace(restoreNeedle, restoreReplacement);

  const catchNeedle = "  } catch (error) {\n    cleanupWorkspace(workspace, 'launch_failed');\n    throw error;\n  }\n}\n\nipcMain.handle('userflex:bootstrap'";
  const catchReplacement = "  } catch (error) {\n    if (delivery && typeof delivery === 'object') delivery.material = null;\n    cleanupWorkspace(workspace, 'launch_failed');\n    throw error;\n  }\n}\n\nipcMain.handle('userflex:bootstrap'";
  if (!source.includes(catchNeedle)) throw new Error('Could not locate openProfile() failure cleanup');
  source = source.replace(catchNeedle, catchReplacement);

  const readyNeedle = "app.whenReady().then(async () => {\n  await getDeviceKey();";
  const readyReplacement = "app.whenReady().then(async () => {\n  await hardenUserDataPermissions().catch(() => null);\n  await getDeviceKey();";
  if (!source.includes(readyNeedle)) throw new Error('Could not locate app.whenReady() startup');
  source = source.replace(readyNeedle, readyReplacement);

  await fs.writeFile(mainPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW profile security hardening ready.');
