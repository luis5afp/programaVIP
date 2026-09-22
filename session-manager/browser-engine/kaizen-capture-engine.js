import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { kaizenProxyPublicIp, probeKaizenProxyDestination, probeKaizenProxyHttps, startKaizenProxyRelay } from './proxy-relay.js';
import { credentialAutofillOrigins } from './credential-policy.js';
import {
  capturePortableSession,
  closeDevtoolsTargets,
  connectCaptureBrowser,
  inspectCaptureSession,
  installCaptureAutomation,
  navigateCaptureHome,
} from './capture-state.js';

function safeSegment(value, fallback = 'profile') {
  const clean = String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  return clean || fallback;
}

function existingFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveCaptureBrowserExecutable(resourcesPath = process.resourcesPath, browserEngine = 'chrome-native') {
  const localApp = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  if (browserEngine === 'nstchrome') {
    return existingFile([path.join(resourcesPath, 'nstchrome', 'chrome.exe')]);
  }
  return existingFile([
    path.join(resourcesPath, 'chrome_native', 'chrome.exe'),
    programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localApp && path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error('No se pudo reservar un puerto local.')));
    });
  });
}

function runPowerShell(script, timeout = 8_000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout,
    }, () => resolve());
  });
}

async function killStrayProfileProcesses(userDataDir) {
  if (process.platform !== 'win32') return;
  const escaped = userDataDir.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await runPowerShell(script);
}


async function markProfileExitedCleanly(userDataDir) {
  const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
  try {
    const raw = await fsp.readFile(preferencesPath, 'utf8');
    const preferences = JSON.parse(raw);
    preferences.profile = preferences.profile && typeof preferences.profile === 'object'
      ? preferences.profile
      : {};
    preferences.profile.exit_type = 'Normal';
    preferences.profile.exited_cleanly = true;
    await fsp.writeFile(preferencesPath, JSON.stringify(preferences), 'utf8');
  } catch {}
}

async function killProcessTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 8_000,
      }, () => resolve());
    });
    return;
  }
  try { proc.kill('SIGTERM'); } catch {}
}

function extensionFiles({ port, secret, profileUrl, extensionStrategy = 'custom' }) {
  const target = new URL(profileUrl);
  const rootHost = target.hostname.replace(/^www\./i, '');
  const allowedOrigins = credentialAutofillOrigins(profileUrl, extensionStrategy);
  const config = JSON.stringify({ port, secret, allowedOrigin: target.origin, allowedOrigins, rootHost });

  const manifest = {
    manifest_version: 3,
    name: 'userFLEX Session Capture',
    version: '2.0.0',
    description: 'Captura local de sesión administrada por userFLEX.',
    permissions: ['tabs', 'webNavigation', 'alarms'],
    host_permissions: ['http://127.0.0.1/*', '<all_urls>'],
    background: { service_worker: 'background.js' },
    content_scripts: [{
      matches: ['http://*/*', 'https://*/*'],
      run_at: 'document_start',
      js: ['content.js'],
    }],
  };

  const background = `const CONFIG = ${config};
const BLOCKED = ['chrome://extensions','chrome://settings','edge://extensions','edge://settings'];
function blocked(url){ const v=String(url||'').toLowerCase(); return BLOCKED.some((p)=>v.startsWith(p)); }
chrome.webNavigation.onBeforeNavigate.addListener((d)=>{ if(d.frameId===0&&blocked(d.url)) chrome.tabs.update(d.tabId,{url:'about:blank'}).catch(()=>{}); });
chrome.tabs.onUpdated.addListener((id,_c,tab)=>{ if(blocked(tab?.url)) chrome.tabs.update(id,{url:'about:blank'}).catch(()=>{}); });
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('userflex-capture',{periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(()=>void chrome.runtime.getPlatformInfo());
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(!msg||msg.type!=='userflex-control') return;
  (async()=>{
    const action=msg.action==='save'?'save':'credentials';
    const response=await fetch('http://127.0.0.1:'+CONFIG.port+'/'+action,{
      method: action==='save'?'POST':'GET',
      headers:{'x-userflex-secret':CONFIG.secret,'content-type':'application/json'},
      body: action==='save'?JSON.stringify({href:msg.href||''}):undefined,
      cache:'no-store'
    });
    const text=await response.text();
    let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}
    if(!response.ok) throw new Error(payload.error||('HTTP '+response.status));
    return payload;
  })().then((value)=>sendResponse({ok:true,...value})).catch((error)=>sendResponse({ok:false,error:error?.message||String(error)}));
  return true;
});`;

  const content = `const CONFIG = ${config};
(()=>{
  const host=String(location.hostname||'').toLowerCase();
  const root=String(CONFIG.rootHost||'').toLowerCase();
  const origin=String(location.origin||'').toLowerCase();
  const allowedOrigins=Array.isArray(CONFIG.allowedOrigins)?CONFIG.allowedOrigins.map((value)=>String(value||'').toLowerCase()):[];
  const googleAuthAllowed=allowedOrigins.includes('https://accounts.google.com')&&location.protocol==='https:'&&(host==='accounts.google.com'||/^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(host));
  if(!(allowedOrigins.includes(origin)||googleAuthAllowed||host===root||host.endsWith('.'+root))) return;

  const stop=(event)=>{event.preventDefault();event.stopPropagation();};
  addEventListener('keydown',(event)=>{
    const key=String(event.key||'').toUpperCase();
    if(key==='F12'||(event.ctrlKey&&event.shiftKey&&['I','J','C'].includes(key))) stop(event);
  },true);
  addEventListener('contextmenu',stop,true);

  let credentials=null;
  const call=(action)=>new Promise((resolve)=>{
    chrome.runtime.sendMessage({type:'userflex-control',action,href:location.href},(reply)=>{
      if(chrome.runtime.lastError) return resolve({ok:false,error:chrome.runtime.lastError.message});
      resolve(reply||{ok:false,error:'Sin respuesta del Session Manager'});
    });
  });
  const visible=(el)=>{try{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}catch{return false;}};
  const setNativeValue=(el,value)=>{
    try{
      try{el.focus({preventScroll:true});}catch{try{el.focus();}catch{}}
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const d=Object.getOwnPropertyDescriptor(proto,'value'); d?.set?.call(el,value);
      try{el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));}
      catch{el.dispatchEvent(new Event('input',{bubbles:true}));}
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      try{el.blur();}catch{}
    }catch{}
  };
  const autofill=()=>{
    if(!credentials) return;
    const inputs=Array.from(document.querySelectorAll('input')).filter((el)=>visible(el)&&!el.disabled&&!el.readOnly);
    const pass=inputs.find((el)=>{
      const hint=[el.type,el.name,el.id,el.autocomplete,el.placeholder,el.getAttribute('aria-label')||''].join(' ').toLowerCase();
      return el.type==='password'||/password|passwd|passcode|contrase/.test(hint);
    });
    const user=inputs.find((el)=>{
      const hint=[el.type,el.name,el.id,el.autocomplete,el.placeholder,el.getAttribute('aria-label')||''].join(' ').toLowerCase();
      return el.type==='email'||/email|e-mail|user|usuario|login|account|identifier|identifierid/.test(hint);
    });
    if(user&&!user.value) setNativeValue(user,credentials.username||'');
    if(pass&&!pass.value) setNativeValue(pass,credentials.password||'');
  };
  const install=()=>{
    if(document.getElementById('userflex-session-overlay')) return;
    const wrap=document.createElement('div');
    wrap.id='userflex-session-overlay';
    wrap.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:14px;padding:12px 14px;box-shadow:0 12px 35px rgba(0,0,0,.35);font:13px system-ui;max-width:340px';
    wrap.innerHTML='<div style="font-weight:800;margin-bottom:8px">userFLEX · Captura KAIZEN</div><div id="userflex-session-message" style="opacity:.82;margin-bottom:10px">Completa el acceso. Cuando la cuenta esté abierta, guarda el perfil completo.</div><button id="userflex-session-save" style="border:0;border-radius:9px;padding:9px 13px;font-weight:800;cursor:pointer">Guardar sesión</button>';
    (document.documentElement||document.body)?.appendChild(wrap);
    const button=wrap.querySelector('#userflex-session-save');
    const message=wrap.querySelector('#userflex-session-message');
    button?.addEventListener('click',async()=>{
      button.disabled=true; button.textContent='Guardando perfil...'; message.textContent='Capturando cookies, almacenamiento e IndexedDB...';
      const result=await call('save');
      if(result.ok){
        button.textContent='Guardada · v'+result.version;
        const idb=Number(result.indexedDbCount||0), cookies=Number(result.cookieCount||0);
        message.textContent='Perfil guardado: '+cookies+' cookies, '+idb+' bases IndexedDB.'+(result.publicIp?' IP: '+result.publicIp:'');
      }else{
        button.disabled=false; button.textContent='Guardar sesión'; message.textContent=result.error||'No se pudo guardar la sesión.';
      }
    });
  };
  const start=async()=>{
    install();
    const result=await call('credentials');
    if(result.ok){credentials={username:result.username||'',password:result.password||''};autofill();}
    const observer=new MutationObserver(()=>{install();autofill();});
    observer.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['type','name','id','autocomplete','placeholder','aria-label','style','class']});
    const retryTimer=setInterval(autofill,1000);
    setTimeout(()=>{try{clearInterval(retryTimer);}catch{} try{observer.disconnect();}catch{}},600000);
    setTimeout(autofill,100); setTimeout(autofill,350); setTimeout(autofill,800); setTimeout(autofill,1500); setTimeout(autofill,3000); setTimeout(autofill,7000);
  };
  if(document.documentElement) void start(); else addEventListener('DOMContentLoaded',()=>void start(),{once:true});
})();`;

  return {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'background.js': background,
    'content.js': content,
  };
}

async function prepareCaptureExtension(baseDir, config) {
  await fsp.rm(baseDir, { recursive: true, force: true });
  await fsp.mkdir(baseDir, { recursive: true });
  const files = extensionFiles(config);
  await Promise.all(Object.entries(files).map(([name, value]) => fsp.writeFile(path.join(baseDir, name), value, 'utf8')));
  return baseDir;
}

async function startControlServer({ secret, credentials, onSave }) {
  let saving = null;
  const server = http.createServer((req, res) => {
    const finish = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-userflex-secret',
        'access-control-allow-private-network': 'true',
      });
      res.end(payload);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-userflex-secret',
        'access-control-allow-private-network': 'true',
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }

    if (req.headers['x-userflex-secret'] !== secret) return finish(403, { error: 'Control local no autorizado.' });
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/credentials' && req.method === 'GET') {
      return finish(200, {
        username: credentials?.username || '',
        password: credentials?.password || '',
      });
    }
    if (url.pathname === '/save' && req.method === 'POST') {
      if (!saving) saving = Promise.resolve().then(onSave).finally(() => { saving = null; });
      void saving.then((value) => finish(200, value)).catch((error) => finish(400, {
        error: error instanceof Error ? error.message : String(error || 'No se pudo guardar la sesión.'),
      }));
      return;
    }
    return finish(404, { error: 'Ruta local no encontrada.' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el control local del navegador.');

  return {
    port: address.port,
    async close() {
      await new Promise((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    },
  };
}

function chromeArgs({ userDataDir, debugPort, proxyRules, extensionDir, background = false }) {
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    ...(background ? ['--window-position=-32000,-32000', '--window-size=1200,900'] : ['--start-maximized']),
    '--disable-features=SignInProfileCreation,SigninConsistency',
    '--disable-password-saving',
    '--disable-save-password-bubble',
    '--disable-session-crashed-bubble',
    '--disable-background-mode',
    '--disable-sync',
    '--allow-browser-signin=false',
    '--lang=es-ES',
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
  ];
  if (proxyRules) args.push(`--proxy-server=${proxyRules}`, '--proxy-bypass-list=localhost;127.0.0.1;[::1]', '--disable-quic');
  args.push('about:blank');
  return args;
}

export function createKaizenCaptureEngine({ app, log = console } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('El motor de captura KAIZEN requiere Electron app.');
  let active = null;

  async function close(reason = 'capture_closed') {
    const entry = active;
    if (!entry) return;
    active = null;
    if (entry.devtoolsTimer) clearInterval(entry.devtoolsTimer);
    if (entry.autoSaveTimer) clearInterval(entry.autoSaveTimer);
    if (entry.autoSaveCloseTimer) clearTimeout(entry.autoSaveCloseTimer);
    try { entry.automation?.cleanup?.(); } catch {}
    try { await entry.browser?.disconnect?.(); } catch {}
    try { await entry.control?.close(); } catch {}
    try { await entry.relay?.close(); } catch {}
    await killProcessTree(entry.process);
    if (entry.extensionDir) {
      try { await fsp.rm(entry.extensionDir, { recursive: true, force: true }); } catch {}
    }
    log.log?.(`Session Manager KAIZEN closed: ${reason}`);
  }

  async function launch({ profile, credentials, proxy = null, onComplete, background = false }) {
    if (!profile?.id || !profile?.url) throw new Error('Configuración de perfil incompleta.');
    if (profile.authStrategy === 'hybrid' && (!credentials?.username || !credentials?.password)) {
      throw new Error('El perfil híbrido no tiene credenciales administradas.');
    }
    await close('replace_capture');

    const executable = resolveCaptureBrowserExecutable(process.resourcesPath, profile.browserEngine || 'chrome-native');
    if (!executable) {
      throw Object.assign(
        new Error(profile.browserEngine === 'nstchrome'
          ? 'Este perfil exige nstchrome, pero el runtime no está instalado en Session Manager.'
          : 'No se encontró Google Chrome/Edge. Instala Chrome o incluye chrome_native con userFLOW.'),
        { code: 'KAIZEN_BROWSER_RUNTIME_MISSING' },
      );
    }

    const userDataDir = path.join(app.getPath('userData'), 'browserProfilesData', safeSegment(profile.id));
    const extensionDir = path.join(app.getPath('userData'), 'capture-extension', safeSegment(profile.id));
    await fsp.mkdir(userDataDir, { recursive: true });
    await killStrayProfileProcesses(userDataDir);
    await markProfileExitedCleanly(userDataDir);

    let relay = null;
    let proxyRules = null;
    let verifiedPublicIp = null;
    if (proxy?.host && proxy?.port) {
      if (String(proxy.type || '').toLowerCase() === 'ssh') throw new Error('El proxy SSH todavía no está soportado por el motor KAIZEN.');
      const target = new URL(profile.url);
      const destinationPort = target.protocol === 'http:' ? 80 : 443;
      await probeKaizenProxyDestination(proxy, { host: target.hostname, port: destinationPort });

      if (target.protocol === 'https:') {
        await probeKaizenProxyHttps(proxy, {
          host: target.hostname,
          port: 443,
          path: target.pathname || '/',
        });
      }

      const googleProfile = String(profile.extensionStrategy || '').toLowerCase() === 'google'
        || target.hostname === 'google.com'
        || target.hostname.endsWith('.google.com');
      if (googleProfile) {
        const googleAuthTargets = [
          { host: 'accounts.google.com', path: '/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F' },
          { host: 'accounts.google.com.co', path: '/accounts/SetSID' },
        ];
        for (const authTarget of googleAuthTargets) {
          try {
            await probeKaizenProxyHttps(proxy, {
              host: authTarget.host,
              port: 443,
              path: authTarget.path,
            });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error || 'conexión rechazada');
            throw new Error(`El proxy del perfil no puede completar HTTPS con ${authTarget.host}. ${detail}`);
          }
        }
      }

      const normalizedTargetHost = target.hostname.replace(/^www\./i, '').toLowerCase();
      const chatgptProfile = normalizedTargetHost === 'chatgpt.com'
        || normalizedTargetHost.endsWith('.chatgpt.com')
        || normalizedTargetHost === 'openai.com'
        || normalizedTargetHost.endsWith('.openai.com');
      if (chatgptProfile) {
        try {
          await probeKaizenProxyHttps(proxy, {
            host: 'auth.openai.com',
            port: 443,
            path: '/',
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error || 'conexión rechazada');
          throw new Error(`El proxy del perfil puede abrir ChatGPT, pero no puede completar HTTPS con auth.openai.com. ${detail}`);
        }
      }

      verifiedPublicIp = await kaizenProxyPublicIp(proxy);
      if (!verifiedPublicIp) throw new Error('El proxy respondió, pero no se pudo verificar su IP pública.');
      if (proxy.publicIp && verifiedPublicIp !== proxy.publicIp) {
        throw new Error(`La IP real del proxy cambió. Esperada: ${proxy.publicIp}. Detectada: ${verifiedPublicIp}.`);
      }

      relay = await startKaizenProxyRelay(proxy);
      proxyRules = relay.proxyRules;
    }

    const debugPort = await freePort();
    const secret = crypto.randomBytes(32).toString('base64url');
    let entry = null;

    const saveCapture = async () => {
      if (!entry || active !== entry) throw new Error('La captura ya no está activa.');
      const captured = await capturePortableSession({
        debugPort,
        profile,
        networkMode: proxy ? 'proxy' : 'direct',
      });
      const publicIp = proxy ? (entry.publicIp || verifiedPublicIp || proxy.publicIp || null) : null;
      const completed = await onComplete({
        material: captured.material,
        publicIp,
        diagnostics: captured.diagnostics,
      });
      return {
        ok: true,
        version: completed.version,
        publicIp: completed.publicIp || publicIp || null,
        cookieCount: captured.diagnostics.cookieCount,
        indexedDbCount: captured.diagnostics.indexedDbCount,
        indexedDbBytes: captured.diagnostics.indexedDbBytes,
      };
    };

    const control = await startControlServer({
      secret,
      credentials,
      onSave: saveCapture,
    });

    await prepareCaptureExtension(extensionDir, {
      port: control.port,
      secret,
      profileUrl: profile.url,
      extensionStrategy: profile.extensionStrategy || 'custom',
    });

    const proc = spawn(executable, chromeArgs({
      userDataDir,
      debugPort,
      proxyRules,
      extensionDir,
      background,
    }), {
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    entry = {
      process: proc,
      debugPort,
      userDataDir,
      extensionDir,
      relay,
      control,
      profile,
      proxy,
      executable,
      browser: null,
      automation: null,
      saveCapture,
      devtoolsTimer: null,
      closed: false,
    };
    active = entry;

    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text && /ERROR|FATAL|proxy/i.test(text)) log.warn?.('Session Manager Chrome:', text.slice(0, 800));
    });
    proc.once('error', (error) => {
      log.error?.('Session Manager Chrome spawn failed:', error?.message || error);
      if (active === entry) void close('spawn_error');
    });
    proc.once('exit', () => {
      if (active === entry) {
        active = null;
        if (entry.devtoolsTimer) clearInterval(entry.devtoolsTimer);
        try { entry.automation?.cleanup?.(); } catch {}
        void entry.browser?.disconnect?.().catch(() => null);
        void entry.control?.close().catch(() => null);
        void entry.relay?.close().catch(() => null);
        if (entry.extensionDir) {
          void fsp.rm(entry.extensionDir, { recursive: true, force: true }).catch(() => null);
        }
      }
    });

    try {
      const browser = await connectCaptureBrowser(debugPort);
      entry.browser = browser;
      entry.automation = await installCaptureAutomation({
        browser,
        profileUrl: profile.url,
        credentials,
        extensionStrategy: profile.extensionStrategy || 'custom',
        controlPort: control.port,
        controlSecret: secret,
        onSave: saveCapture,
      });

      if (proxy) {
        entry.publicIp = verifiedPublicIp || proxy.publicIp || null;
      }

      await navigateCaptureHome(debugPort, profile.url);
      entry.devtoolsTimer = setInterval(() => void closeDevtoolsTargets(debugPort), 700);
      entry.devtoolsTimer.unref?.();

      return {
        ok: true,
        external: true,
        pid: proc.pid,
        debugPort,
        profileDir: userDataDir,
        publicIp: entry.publicIp || null,
      };
    } catch (error) {
      await close('launch_failed');
      throw error;
    }
  }

  async function saveActive() {
    if (!active || active.closed || typeof active.saveCapture !== 'function') {
      throw new Error('No hay una captura activa para guardar.');
    }
    return active.saveCapture();
  }

  async function inspectActive() {
    if (!active || active.closed || !active.debugPort || !active.profile?.url) {
      throw new Error('No hay una sesión activa para verificar.');
    }
    return inspectCaptureSession(active.debugPort, active.profile.url);
  }

  return {
    launch,
    close,
    saveActive,
    inspectActive,
    get active() { return active; },
  };
}
