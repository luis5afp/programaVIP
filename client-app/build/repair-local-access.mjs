import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', 'main.js');
const marker = '// userFLOW local access repair v1';
let source = (await fs.readFile(mainPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const hardenStart = source.indexOf('async function hardenUserDataPermissions() {');
  const hardenEnd = source.indexOf('\n\nasync function getDeviceKey()', hardenStart);
  if (hardenStart < 0 || hardenEnd < 0) throw new Error('Could not locate hardenUserDataPermissions()');

  const safePermissions = `${marker}\nfunction isLocalPermissionError(error) {\n  return ['EPERM', 'EACCES'].includes(String(error?.code || ''));\n}\n\nasync function currentWindowsUserSid() {\n  if (process.platform !== 'win32') return null;\n  try {\n    const result = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 4000 });\n    return String(result?.stdout || '').match(/\\\"[^\\\"]*\\\",\\\"(S-[^\\\"]+)\\\"/i)?.[1] || null;\n  } catch {\n    return null;\n  }\n}\n\nasync function repairLocalPathAccess(targetPath) {\n  if (process.platform !== 'win32' || !targetPath) return false;\n  const sid = await currentWindowsUserSid();\n  if (!sid) return false;\n  try {\n    await execFileAsync('icacls.exe', [\n      targetPath,\n      '/inheritance:e',\n      '/grant:r', \`*${'${sid}'}:F\`,\n      '/Q',\n    ], { windowsHide: true, timeout: 5000 });\n    return true;\n  } catch {\n    return false;\n  }\n}\n\nasync function repairKnownMetadataAccess() {\n  if (process.platform !== 'win32') return;\n  const userData = app.getPath('userData');\n  await repairLocalPathAccess(userData);\n  for (const file of [\n    path.join(userData, 'device.json'),\n    path.join(userData, 'auth.json'),\n    path.join(userData, 'profile-registry.json'),\n    path.join(userData, 'profile-session-state.json'),\n  ]) {\n    try {\n      await fs.access(file);\n    } catch (error) {\n      if (!isLocalPermissionError(error)) continue;\n    }\n    await repairLocalPathAccess(file);\n  }\n}\n\nasync function hardenUserDataPermissions() {\n  const userData = app.getPath('userData');\n  await fs.mkdir(userData, { recursive: true, mode: 0o700 });\n  if (process.platform !== 'win32') {\n    await fs.chmod(userData, 0o700).catch(() => null);\n    return;\n  }\n  // Windows already protects AppData with per-user ACLs. Do not replace or\n  // recursively rewrite those ACLs: doing so can lock the application out of\n  // its own Chromium profile when the process token changes. Only repair known\n  // metadata files if an older userFLOW version left them inaccessible.\n  await repairKnownMetadataAccess();\n}\n`;

  source = source.slice(0, hardenStart) + safePermissions + source.slice(hardenEnd);

  const deviceStart = source.indexOf('async function getDeviceKey() {');
  const deviceEnd = source.indexOf('\n\nasync function saveAuth(', deviceStart);
  if (deviceStart < 0 || deviceEnd < 0) throw new Error('Could not locate getDeviceKey()');

  const safeDevice = `async function readExistingDeviceKey() {\n  const raw = JSON.parse(await fs.readFile(devicePath(), 'utf8'));\n  return typeof raw?.deviceKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(raw.deviceKey)\n    ? raw.deviceKey\n    : null;\n}\n\nasync function getDeviceKey() {\n  let readError = null;\n  try {\n    const existing = await readExistingDeviceKey();\n    if (existing) return existing;\n  } catch (error) {\n    readError = error;\n  }\n\n  if (isLocalPermissionError(readError)) {\n    await repairLocalPathAccess(app.getPath('userData'));\n    await repairLocalPathAccess(devicePath());\n    try {\n      const existing = await readExistingDeviceKey();\n      if (existing) return existing;\n    } catch {}\n  }\n\n  const deviceKey = crypto.randomBytes(32).toString('base64url');\n  await fs.mkdir(path.dirname(devicePath()), { recursive: true });\n  try {\n    await fs.writeFile(devicePath(), JSON.stringify({ deviceKey }), { encoding: 'utf8', mode: 0o600 });\n  } catch (error) {\n    if (!isLocalPermissionError(error)) throw error;\n    await repairLocalPathAccess(app.getPath('userData'));\n    await repairLocalPathAccess(devicePath());\n    try {\n      await fs.writeFile(devicePath(), JSON.stringify({ deviceKey }), { encoding: 'utf8', mode: 0o600 });\n    } catch {\n      throw new UserflexError('Windows bloqueó el acceso al almacenamiento local de userFLOW. Cierra el programa y vuelve a abrirlo para reparar los permisos.', 'LOCAL_STORAGE_ACCESS_DENIED');\n    }\n  }\n  return deviceKey;\n}\n`;

  source = source.slice(0, deviceStart) + safeDevice + source.slice(deviceEnd);

  const saveStart = source.indexOf('async function saveAuth(token, meta) {');
  const saveEnd = source.indexOf('\n\nasync function loadAuth()', saveStart);
  if (saveStart < 0 || saveEnd < 0) throw new Error('Could not locate saveAuth()');

  const safeSaveAuth = `async function saveAuth(token, meta) {\n  accessToken = token;\n  authMeta = meta || null;\n  if (!safeStorage.isEncryptionAvailable()) return;\n  const encrypted = safeStorage.encryptString(token).toString('base64');\n  const file = authPath();\n  await fs.mkdir(path.dirname(file), { recursive: true });\n  const payload = JSON.stringify({ token: encrypted, meta });\n  try {\n    await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 });\n  } catch (error) {\n    if (!isLocalPermissionError(error)) throw error;\n    await repairLocalPathAccess(app.getPath('userData'));\n    await repairLocalPathAccess(file);\n    await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 });\n  }\n}\n`;

  source = source.slice(0, saveStart) + safeSaveAuth + source.slice(saveEnd);

  const loadStart = source.indexOf('async function loadAuth() {');
  const loadEnd = source.indexOf('\n\nasync function clearAuth()', loadStart);
  if (loadStart < 0 || loadEnd < 0) throw new Error('Could not locate loadAuth()');

  const safeLoadAuth = `async function loadAuth() {\n  if (!safeStorage.isEncryptionAvailable()) return null;\n\n  const read = async () => {\n    const raw = JSON.parse(await fs.readFile(authPath(), 'utf8'));\n    if (typeof raw?.token !== 'string') return null;\n    const token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));\n    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;\n    accessToken = token;\n    authMeta = raw.meta || null;\n    return { token, meta: authMeta };\n  };\n\n  try {\n    return await read();\n  } catch (error) {\n    if (!isLocalPermissionError(error)) return null;\n    await repairLocalPathAccess(app.getPath('userData'));\n    await repairLocalPathAccess(authPath());\n    try {\n      return await read();\n    } catch {\n      return null;\n    }\n  }\n}\n`;

  source = source.slice(0, loadStart) + safeLoadAuth + source.slice(loadEnd);
  await fs.writeFile(mainPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW local access repair ready.');
