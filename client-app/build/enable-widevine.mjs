import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', 'main.js');
const marker = '// userFLOW Widevine profile runtime v1';
let source = (await fs.readFile(mainPath, 'utf8')).replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const electronImportPattern = /import \{ app, BrowserWindow, WebContentsView, ipcMain, safeStorage, screen(?:, session)? \} from 'electron';/;
  const electronImport = source.match(electronImportPattern)?.[0] || null;
  if (!electronImport) throw new Error('Could not locate Electron import in main.js');
  source = source.replace(
    electronImport,
    `${electronImport}\nimport { enableProtectedContentForSession, ensureWidevineReady, widevineDiagnostics } from './widevine-runtime.js';`,
  );

  const oldCreate = `  const firstPage = createProfilePageView(workspace);\n  workspace.activePageId = firstPage.id;\n  const browserSession = firstPage.view.webContents.session;`;
  const newCreate = `  ${marker}\n  // A renderer created before castLabs finishes loading Widevine cannot use the\n  // CDM for its lifetime. The updater is prewarmed during app startup; wait a\n  // bounded amount here before creating the isolated profile renderer. Normal\n  // browsing remains available if the component service is temporarily down.\n  const widevineReady = await ensureWidevineReady(12_000);\n  if (!widevineReady) console.warn('Widevine not ready for profile renderer', widevineDiagnostics());\n\n  const firstPage = createProfilePageView(workspace);\n  workspace.activePageId = firstPage.id;\n  const browserSession = firstPage.view.webContents.session;\n  enableProtectedContentForSession(browserSession);\n  workspace.widevineReady = widevineReady;`;
  if (!source.includes(oldCreate)) throw new Error('Could not locate profile renderer creation in main.js');
  source = source.replace(oldCreate, newCreate);

  const oldReturn = `      sessionVersion: Number(delivery?.version || 0),\n    };`;
  const newReturn = `      sessionVersion: Number(delivery?.version || 0),\n      widevineReady: workspace.widevineReady === true,\n    };`;
  if (!source.includes(oldReturn)) throw new Error('Could not locate profile launch result in main.js');
  source = source.replace(oldReturn, newReturn);

  await fs.writeFile(mainPath, source, 'utf8');
}

if (!source.includes(marker) || !source.includes('enableProtectedContentForSession(browserSession)')) {
  throw new Error('Widevine profile integration is not installed');
}

const check = spawnSync(process.execPath, ['--check', mainPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW Widevine profile runtime ready.');
