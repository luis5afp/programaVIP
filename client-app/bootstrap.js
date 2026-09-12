import { app, BrowserWindow, Menu } from 'electron';
import updaterPackage from 'electron-updater';

const { autoUpdater } = updaterPackage;

await app.whenReady();
Menu.setApplicationMenu(null);

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };
// electron-updater emits an `error` event in addition to rejecting promises.
// Keep a listener registered so a network/update failure never crashes startup.
autoUpdater.on('error', () => {});

let splashWindow = null;
let splashReady = false;
let pendingStatus = null;
let checking = false;
let mainStarted = false;
let targetVersion = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function splashHtml() {
  const version = escapeHtml(app.getVersion());
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>userFLEX Client</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7fb;color:#0f172a;overflow:hidden}
body{background:radial-gradient(circle at 18% 12%,rgba(99,102,241,.11),transparent 32%),radial-gradient(circle at 88% 88%,rgba(14,165,233,.07),transparent 28%),#f8fafc}
.center{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:8px}.mark{width:64px;height:64px;border-radius:18px;background:linear-gradient(145deg,#7367f0,#5946ee);color:#fff;display:grid;place-items:center;font-size:22px;font-weight:900;box-shadow:0 12px 30px rgba(89,70,238,.24)}h1{margin:10px 0 0;font-size:30px;letter-spacing:-.8px}p{margin:0;color:#64748b;font-size:14px}
.update{position:fixed;left:24px;bottom:22px;width:min(430px,calc(100vw - 48px));padding:13px 15px;border-radius:14px;background:rgba(255,255,255,.96);border:1px solid #dfe6f1;box-shadow:0 12px 34px rgba(15,23,42,.08)}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;color:#475569;font-size:12px;font-weight:700}.percent{color:#4338ca;font-variant-numeric:tabular-nums}.track{height:6px;margin-top:9px;border-radius:999px;background:#e8eaf7;overflow:hidden}.bar{height:100%;width:0;background:linear-gradient(90deg,#6557ef,#4f46e5);transition:width .15s linear}.retry{display:none;margin-top:10px;color:#4338ca;font-size:12px;font-weight:800;text-decoration:none}.retry:hover{text-decoration:underline}.error .row{color:#991b1b}.error{border-color:#fecdd3;background:#fffafb}.error .retry{display:inline-block}.ready .row{color:#047857}.ready .track{display:none}
.version{position:fixed;right:24px;bottom:25px;color:#94a3b8;font-size:11px}
</style>
</head>
<body>
<div class="center"><div class="mark">uF</div><h1>userFLEX Client</h1><p>Preparando el programa…</p></div>
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
    title: 'userFLEX Client',
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

autoUpdater.on('download-progress', (progress) => {
  const percent = Number(progress?.percent || 0);
  pushStatus({
    phase: 'downloading',
    message: `Actualizando a v${targetVersion || 'nueva'}…`,
    percent,
  });
});

async function checkUpdatesAndContinue() {
  if (checking || mainStarted) return;
  checking = true;
  targetVersion = null;
  pushStatus({ phase: 'checking', message: 'Verificando actualización…', percent: null });

  try {
    if (!app.isPackaged) {
      await startMain();
      return;
    }

    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo?.version || app.getVersion();
    if (!isNewerVersion(latestVersion, app.getVersion())) {
      await startMain();
      return;
    }

    targetVersion = latestVersion;
    pushStatus({ phase: 'downloading', message: `Actualizando a v${latestVersion}…`, percent: 0 });
    await autoUpdater.downloadUpdate();
    pushStatus({ phase: 'installing', message: `Actualización v${latestVersion} descargada · instalando…`, percent: 100 });
    await wait(650);
    autoUpdater.quitAndInstall(false, true);
  } catch {
    pushStatus({
      phase: 'error',
      message: 'No se pudo verificar o descargar la actualización. Revisa tu conexión.',
      percent: null,
    });
  } finally {
    checking = false;
  }
}

createSplash();
await checkUpdatesAndContinue();
