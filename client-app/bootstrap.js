import { app, BrowserWindow, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const UPDATE_API_URL = 'https://userflex-admin.luis5afp.workers.dev/api/client-update';
const UPDATE_MANIFEST_URL = `${UPDATE_API_URL}/latest`;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const MAX_UPDATE_BYTES = 300 * 1024 * 1024;

// Keep the original user-data directory so the rebrand does not register a new
// device or lose the client's encrypted login/profile partitions.
app.setPath('userData', path.join(app.getPath('appData'), 'userFLEX Client'));
app.setName('userFLOW');
await app.whenReady();
Menu.setApplicationMenu(null);

let splashWindow = null;
let splashReady = false;
let pendingStatus = null;
let checking = false;
let mainStarted = false;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function splashHtml() {
  const version = escapeHtml(app.getVersion());
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>userFLOW</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7fb;color:#0f172a;overflow:hidden}
body{background:radial-gradient(circle at 18% 12%,rgba(99,102,241,.11),transparent 32%),radial-gradient(circle at 88% 88%,rgba(14,165,233,.07),transparent 28%),#f8fafc}
.center{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px}.mark{width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#7cf8ff 0,#35d5cf 24%,#6b29b8 52%,#171143 100%);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:900;box-shadow:0 12px 34px rgba(74,45,170,.30),inset 0 0 0 3px rgba(93,245,227,.72);text-shadow:0 0 12px rgba(255,255,255,.55)}h1{margin:10px 0 0;font-size:30px;letter-spacing:-.8px}p{margin:0;color:#64748b;font-size:14px}
.update{position:fixed;left:24px;bottom:22px;width:min(430px,calc(100vw - 48px));padding:13px 15px;border-radius:14px;background:rgba(255,255,255,.96);border:1px solid #dfe6f1;box-shadow:0 12px 34px rgba(15,23,42,.08)}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;color:#475569;font-size:12px;font-weight:700}.percent{color:#4338ca;font-variant-numeric:tabular-nums}.track{height:6px;margin-top:9px;border-radius:999px;background:#e8eaf7;overflow:hidden}.bar{height:100%;width:0;background:linear-gradient(90deg,#6557ef,#4f46e5);transition:width .15s linear}.retry{display:none;margin-top:10px;color:#4338ca;font-size:12px;font-weight:800;text-decoration:none}.retry:hover{text-decoration:underline}.error .row{color:#991b1b}.error{border-color:#fecdd3;background:#fffafb}.error .retry{display:inline-block}.ready .row{color:#047857}.ready .track{display:none}
.version{position:fixed;right:24px;bottom:25px;color:#94a3b8;font-size:11px}
</style>
</head>
<body>
<div class="center"><div class="mark">uF</div><h1>userFLOW</h1><p>Preparando el programa…</p></div>
<div id="update" class="update"><div class="row"><span id="label">Verificando actualización…</span><span id="percent" class="percent"></span></div><div id="track" class="track"><div id="bar" class="bar"></div></div><a id="retry" class="retry" href="userflex-update://retry">Reintentar verificación</a></div>
<div class="version">v${version}</div>
<script>
window.userflexSetUpdateStatus=(state)=>{
 const box=document.getElementById('update');const label=document.getElementById('label');const pct=document.getElementById('percent');const bar=document.getElementById('bar');const track=document.getElementById('track');
 box.className='update'+(state.phase==='error'?' error':'')+(state.phase==='ready'?' ready':'');
 label.textContent=state.message||'Verificando actualización…';
 const value=Number.isFinite(state.percent)?Math.max(0,Math.min(100,Math.round(state.percent))):null;
 pct.textContent=value===null?'':value+'%';bar.style.width=(value===null?0:value)+'%';
 track.style.display=(state.phase==='downloading'||state.phase==='installing')?'block':(state.phase==='ready'?'none':'block');
};
</script>
</body></html>`;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 920,
    height: 600,
    minWidth: 760,
    minHeight: 500,
    title: 'userFLOW',
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow?.isDestroyed()) splashWindow.show();
  });
  splashWindow.webContents.on('did-finish-load', () => {
    splashReady = true;
    if (pendingStatus) pushStatus(pendingStatus);
  });
  splashWindow.webContents.on('will-navigate', (event, url) => {
    if (url === 'userflex-update://retry') {
      event.preventDefault();
      void checkUpdatesAndContinue();
      return;
    }
    if (!url.startsWith('data:text/html')) event.preventDefault();
  });
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
}

function pushStatus(status) {
  pendingStatus = status;
  if (!splashReady || !splashWindow || splashWindow.isDestroyed()) return;
  void splashWindow.webContents
    .executeJavaScript(`window.userflexSetUpdateStatus(${JSON.stringify(status)})`)
    .catch(() => {});
}

function versionParts(value) {
  return String(value || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
    .slice(0, 4);
}

function isNewerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startMain() {
  if (mainStarted) return;
  mainStarted = true;
  pushStatus({ phase: 'ready', message: `v${app.getVersion()} · Actualizado`, percent: null });
  await wait(180);
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
  await import('./main.js');
}

function validateManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('UPDATE_MANIFEST_INVALID');
  const version = String(value.version || '').trim();
  const sha256 = String(value.sha256 || '').trim().toLowerCase();
  const size = Number(value.size || 0);
  const chunks = Array.isArray(value.chunks) ? value.chunks : [];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('UPDATE_VERSION_INVALID');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('UPDATE_HASH_INVALID');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPDATE_BYTES) throw new Error('UPDATE_SIZE_INVALID');
  if (chunks.length < 1 || chunks.length > 64) throw new Error('UPDATE_CHUNKS_INVALID');

  let chunkBytes = 0;
  const normalizedChunks = chunks.map((chunk, index) => {
    const name = String(chunk?.name || '').trim();
    const chunkSize = Number(chunk?.size || 0);
    const expectedPrefix = `versions/${version}/`;
    if (!name.startsWith(expectedPrefix) || !/^versions\/[0-9A-Za-z.-]+\/part-\d{3}\.bin$/.test(name)) {
      throw new Error(`UPDATE_CHUNK_NAME_INVALID_${index}`);
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 25 * 1024 * 1024) {
      throw new Error(`UPDATE_CHUNK_SIZE_INVALID_${index}`);
    }
    chunkBytes += chunkSize;
    return { name, size: chunkSize };
  });
  if (chunkBytes !== size) throw new Error('UPDATE_TOTAL_SIZE_MISMATCH');
  return { version, sha256, size, chunks: normalizedChunks };
}

async function fetchManifest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?ts=${Date.now()}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`UPDATE_MANIFEST_HTTP_${response.status}`);
    return validateManifest(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function updateChunkUrl(chunkName, version) {
  const match = String(chunkName || '').match(/^versions\/([^/]+)\/(part-\d{3}\.bin)$/);
  if (!match || match[1] !== version) throw new Error('UPDATE_CHUNK_PATH_INVALID');
  return `${UPDATE_API_URL}/chunks/${encodeURIComponent(version)}/${match[2]}`;
}

async function downloadInstaller(manifest) {
  const updateDir = path.join(app.getPath('userData'), 'updates');
  await fs.rm(updateDir, { recursive: true, force: true });
  await fs.mkdir(updateDir, { recursive: true });
  const installerPath = path.join(updateDir, `userFLOW-${manifest.version}-Setup.exe`);
  const file = await fs.open(installerPath, 'w');
  const hash = crypto.createHash('sha256');
  let totalReceived = 0;

  try {
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      const chunk = manifest.chunks[index];
      const response = await fetch(updateChunkUrl(chunk.name, manifest.version), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok || !response.body) throw new Error(`UPDATE_CHUNK_HTTP_${response.status}`);
      const reader = response.body.getReader();
      let chunkReceived = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const buffer = Buffer.from(value);
        await file.write(buffer);
        hash.update(buffer);
        totalReceived += buffer.length;
        chunkReceived += buffer.length;
        const percent = Math.min(99, (totalReceived / manifest.size) * 100);
        pushStatus({ phase: 'downloading', message: `Actualizando a v${manifest.version}…`, percent });
      }
      if (chunkReceived !== chunk.size) throw new Error(`UPDATE_CHUNK_LENGTH_MISMATCH_${index}`);
    }
    await file.sync();
  } finally {
    await file.close();
  }

  if (totalReceived !== manifest.size) {
    await fs.rm(installerPath, { force: true });
    throw new Error('UPDATE_FILE_LENGTH_MISMATCH');
  }
  const digest = hash.digest('hex');
  if (digest !== manifest.sha256) {
    await fs.rm(installerPath, { force: true });
    throw new Error('UPDATE_FILE_HASH_MISMATCH');
  }
  return installerPath;
}

async function installAndRestart(installerPath) {
  const child = spawn(installerPath, ['/S'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  child.unref();

  // The NSIS customInit closes this old executable after the installer is
  // already running. This fallback prevents an old instance from surviving if
  // Windows delays taskkill for any reason.
  const quitFallback = setTimeout(() => app.quit(), 5_000);
  quitFallback.unref?.();
}

async function checkUpdatesAndContinue() {
  if (checking || mainStarted) return;
  checking = true;
  pushStatus({ phase: 'checking', message: 'Verificando actualización…', percent: null });

  try {
    if (!app.isPackaged) {
      await startMain();
      return;
    }

    const manifest = await fetchManifest();
    if (!isNewerVersion(manifest.version, app.getVersion())) {
      await startMain();
      return;
    }

    pushStatus({ phase: 'downloading', message: `Actualizando a v${manifest.version}…`, percent: 0 });
    const installerPath = await downloadInstaller(manifest);
    pushStatus({ phase: 'installing', message: `Actualización v${manifest.version} verificada · instalando…`, percent: 100 });
    await wait(650);
    await installAndRestart(installerPath);
  } catch (error) {
    console.error('userFLOW updater error', error instanceof Error ? error.message : String(error));
    pushStatus({
      phase: 'error',
      message: 'No se pudo completar la actualización. Reintenta o instala la nueva versión manualmente.',
      percent: null,
    });
  } finally {
    checking = false;
  }
}

createSplash();
await checkUpdatesAndContinue();
