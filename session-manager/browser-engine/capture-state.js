import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { canonicalGoogleAccountsUrl, credentialAutofillAllowsUrl, credentialAutofillOrigins } from './credential-policy.js';

export async function waitForDevtools(debugPort, timeoutMs = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return true;
    } catch {}
    await delay(250);
  }
  return false;
}

export async function connectCaptureBrowser(debugPort) {
  if (!await waitForDevtools(debugPort)) {
    throw new Error('Chrome no abrió su puerto de control para capturar la sesión.');
  }
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${debugPort}`,
    defaultViewport: null,
  });
}

function domainMatches(cookieDomain, hostname) {
  const domain = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
  const host = String(hostname || '').toLowerCase();
  return Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
}

function isGoogleFlowHost(hostname) {
  return String(hostname || '').toLowerCase() === 'flow.google.com';
}

function isGoogleAccountsHost(hostname) {
  const host = String(hostname || '').replace(/^\./, '').toLowerCase();
  return host === 'accounts.google.com' || /^accounts\.google\.[a-z.]+$/i.test(host);
}

function cookieRelevantToTarget(cookieDomain, targetHostname) {
  if (domainMatches(cookieDomain, targetHostname)) return true;
  return isGoogleFlowHost(targetHostname) && isGoogleAccountsHost(cookieDomain);
}

function isGoogleAuthCookieName(name) {
  return /^(?:SID|HSID|SSID|APISID|SAPISID|__Secure-(?:1P|3P)?SID|__Secure-(?:1P|3P)?APISID)$/i
    .test(String(name || ''));
}

function isNetflixHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'netflix.com' || host.endsWith('.netflix.com');
}

function isNetflixLandingPath(pathname) {
  const path = String(pathname || '').toLowerCase();
  return path === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/.test(path);
}

function isNetflixAuthenticatedAppPath(pathname) {
  return /^\/(?:browse|profiles|manageprofiles|switchprofile|kids|latest|search|title|watch|youraccount|account)(?:\/|$)/i
    .test(String(pathname || ''));
}

export function captureNavigationTarget(profileUrl) {
  const target = new URL(profileUrl);
  if (isNetflixHost(target.hostname) && isNetflixLandingPath(target.pathname)) {
    target.pathname = '/browse';
    target.search = '';
    target.hash = '';
  }
  return target;
}

function normalizeCookie(cookie) {
  return {
    name: String(cookie?.name || ''),
    value: String(cookie?.value ?? ''),
    domain: String(cookie?.domain || ''),
    hostOnly: !String(cookie?.domain || '').startsWith('.'),
    path: String(cookie?.path || '/'),
    secure: cookie?.secure === true,
    httpOnly: cookie?.httpOnly === true,
    sameSite: cookie?.sameSite || 'unspecified',
    expirationDate: Number.isFinite(Number(cookie?.expires)) && Number(cookie.expires) > 0
      ? Number(cookie.expires)
      : undefined,
    session: cookie?.session === true || !(Number(cookie?.expires) > 0),
  };
}

async function pageForOrigin(browser, target) {
  const pages = await browser.pages();
  for (const page of pages) {
    try {
      if (new URL(page.url()).origin === target.origin) return page;
    } catch {}
  }
  const page = pages.find((item) => item.url() === 'about:blank') || pages[0] || await browser.newPage();
  if (page.url() !== target.toString()) {
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }
  return page;
}

async function validateCapturePage(page, target) {
  const state = await page.evaluate(() => ({
    href: location.href,
    origin: location.origin,
    pathname: location.pathname,
    text: String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 120000),
  }));
  if (state.origin !== target.origin) {
    throw new Error(`La pestaña activa no corresponde a ${target.hostname}. Abre el perfil correcto antes de guardar.`);
  }

  if (isNetflixHost(target.hostname)) {
    const pathname = String(state.pathname || '').toLowerCase();
    if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
      throw new Error('Netflix todavía no tiene la cuenta abierta. Completa el inicio de sesión antes de guardar.');
    }
    if (isNetflixLandingPath(pathname)) {
      throw new Error('Netflix está en la portada pública, no dentro de la cuenta. Espera a que abra /browse antes de guardar.');
    }
    const text = String(state.text || '').toLowerCase();
    const errorSignals = [
      'sentimos la interrupción',
      'tenemos problemas con tu solicitud',
      'código de error',
      'pardon the interruption',
      "we're having trouble",
      'error code',
    ];
    if (errorSignals.some((signal) => text.includes(signal))) {
      throw new Error('Netflix está mostrando una página de error. Vuelve a la pantalla normal de Netflix antes de guardar.');
    }
  }
  return state;
}

async function readWebStorageAndIndexedDb(page) {
  return page.evaluate(async () => {
    const toBase64 = (bytes) => {
      let binary = '';
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const chunk = 0x8000;
      for (let offset = 0; offset < view.length; offset += chunk) {
        binary += String.fromCharCode(...view.subarray(offset, offset + chunk));
      }
      return btoa(binary);
    };

    const seen = new WeakSet();
    const encode = async (value) => {
      if (value === undefined) return { __ufType: 'undefined' };
      if (typeof value === 'bigint') return { __ufType: 'bigint', value: value.toString() };
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      if (value instanceof Date) return { __ufType: 'date', value: value.toISOString() };
      if (value instanceof ArrayBuffer) return { __ufType: 'arraybuffer', value: toBase64(new Uint8Array(value)) };
      if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { __ufType: 'typedarray', name: value.constructor?.name || 'Uint8Array', value: toBase64(bytes) };
      }
      if (typeof Blob !== 'undefined' && value instanceof Blob) {
        const bytes = new Uint8Array(await value.arrayBuffer());
        return {
          __ufType: value instanceof File ? 'file' : 'blob',
          type: value.type || '',
          name: value instanceof File ? value.name : undefined,
          lastModified: value instanceof File ? value.lastModified : undefined,
          value: toBase64(bytes),
        };
      }
      if (value instanceof Map) {
        return { __ufType: 'map', value: await Promise.all(Array.from(value.entries()).map(async ([k, v]) => [await encode(k), await encode(v)])) };
      }
      if (value instanceof Set) {
        return { __ufType: 'set', value: await Promise.all(Array.from(value.values()).map(encode)) };
      }
      if (Array.isArray(value)) return Promise.all(value.map(encode));
      if (typeof value === 'object') {
        if (seen.has(value)) return { __ufType: 'undefined' };
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value)) {
          try { out[key] = await encode(value[key]); } catch {}
        }
        return out;
      }
      return String(value);
    };

    const readStore = (store) => {
      const requestAll = store.getAll();
      const requestKeys = store.getAllKeys();
      return Promise.all([
        new Promise((resolve, reject) => {
          requestAll.onsuccess = () => resolve(requestAll.result || []);
          requestAll.onerror = () => reject(requestAll.error || new Error('getAll failed'));
        }),
        new Promise((resolve, reject) => {
          requestKeys.onsuccess = () => resolve(requestKeys.result || []);
          requestKeys.onerror = () => reject(requestKeys.error || new Error('getAllKeys failed'));
        }),
      ]);
    };

    const openDatabase = (info) => new Promise((resolve) => {
      let request;
      try { request = indexedDB.open(info.name); } catch { return resolve(null); }
      request.onerror = () => resolve(null);
      request.onsuccess = async () => {
        const db = request.result;
        try {
          const storeNames = Array.from(db.objectStoreNames);
          const stores = [];
          for (const name of storeNames) {
            try {
              // One transaction per store keeps the transaction alive while its
              // getAll/getAllKeys pair completes. A single transaction spanning
              // many stores can auto-commit between awaited stores.
              const tx = db.transaction([name], 'readonly');
              const store = tx.objectStore(name);
              const indexes = Array.from(store.indexNames).map((indexName) => {
                const index = store.index(indexName);
                return {
                  name: index.name,
                  keyPath: index.keyPath,
                  unique: index.unique === true,
                  multiEntry: index.multiEntry === true,
                };
              });
              const [values, keys] = await readStore(store);
              const records = [];
              const count = Math.min(values.length, keys.length, 50000);
              for (let i = 0; i < count; i += 1) {
                records.push({
                  primaryKey: await encode(keys[i]),
                  value: await encode(values[i]),
                });
              }
              stores.push({
                name,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement === true,
                indexes,
                records,
                truncated: values.length > count,
              });
            } catch {}
          }
          resolve({
            name: db.name,
            version: db.version,
            stores,
          });
        } finally {
          try { db.close(); } catch {}
        }
      };
    });

    const readStorage = (store) => {
      const result = {};
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (key != null) result[key] = store.getItem(key);
        }
      } catch {}
      return result;
    };

    let databases = [];
    try {
      if (typeof indexedDB.databases === 'function') {
        databases = (await indexedDB.databases()).filter((item) => item?.name);
      }
    } catch {}

    const indexedDBSnapshot = [];
    for (const info of databases) {
      const snapshot = await openDatabase(info);
      if (snapshot) indexedDBSnapshot.push(snapshot);
    }

    return {
      origin: location.origin,
      href: location.href,
      localStorage: readStorage(localStorage),
      sessionStorage: readStorage(sessionStorage),
      indexedDB: indexedDBSnapshot,
    };
  });
}

async function allCookies(page) {
  const client = await page.createCDPSession();
  try {
    const result = await client.send('Storage.getCookies');
    return Array.isArray(result?.cookies) ? result.cookies : [];
  } finally {
    await client.detach().catch(() => null);
  }
}

export async function browserPublicIp(debugPort) {
  const browser = await connectCaptureBrowser(debugPort);
  try {
    let page = (await browser.pages()).find((item) => item.url() === 'about:blank');
    let temporary = false;
    if (!page) {
      page = await browser.newPage();
      temporary = true;
    }
    await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const raw = await page.evaluate(() => document.body?.innerText || '');
    if (temporary) await page.close().catch(() => null);
    const payload = JSON.parse(raw);
    return typeof payload?.ip === 'string' ? payload.ip.trim() : null;
  } catch {
    return null;
  } finally {
    await browser.disconnect().catch(() => null);
  }
}


export async function installCaptureAutomation({
  browser,
  profileUrl,
  credentials = null,
  extensionStrategy = 'custom',
  controlPort,
  controlSecret,
  onSave = null,
}) {
  if (!browser) throw new Error('El navegador de captura no está conectado.');
  const allowedOrigins = credentialAutofillOrigins(profileUrl, extensionStrategy);
  const payload = {
    allowedOrigins,
    username: String(credentials?.username || ''),
    password: String(credentials?.password || ''),
    controlUrl: 'http://127.0.0.1:' + Number(controlPort || 0),
    controlSecret: String(controlSecret || ''),
    saveBinding: '__userflexCaptureSave_' + String(controlSecret || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 18),
  };

  const bootstrap = ({ allowedOrigins, username, password, controlUrl, controlSecret, saveBinding }) => {
    const currentHost = String(location.hostname || '').toLowerCase();
    const currentPath = String(location.pathname || '').toLowerCase();
    const openAiSecurityHost = currentHost === 'auth.openai.com'
      || currentHost.endsWith('.auth.openai.com')
      || currentHost === 'challenges.cloudflare.com'
      || currentHost.endsWith('.challenges.cloudflare.com');
    const openAiLoginPage = currentHost === 'chatgpt.com' && currentPath.startsWith('/auth/');
    if (openAiSecurityHost || openAiLoginPage) return;
    const googleAuthAllowed = Array.isArray(allowedOrigins)
      && allowedOrigins.includes('https://accounts.google.com')
      && location.protocol === 'https:'
      && (currentHost === 'accounts.google.com'
        || /^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(currentHost));
    if (!Array.isArray(allowedOrigins) || (!allowedOrigins.includes(location.origin) && !googleAuthAllowed)) return;

    const GLOBAL_KEY = '__userflexCaptureAutomationV312';
    const existing = globalThis[GLOBAL_KEY];
    if (existing?.refresh) {
      try { existing.refresh(); } catch {}
      return;
    }

    const visible = (element) => {
      try {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) !== 0
          && rect.width > 0
          && rect.height > 0;
      } catch {
        return false;
      }
    };

    const fieldKind = (element) => {
      if (!(element instanceof HTMLInputElement)) return null;
      const type = String(element.type || '').toLowerCase();
      const hint = [
        type,
        element.name,
        element.id,
        element.autocomplete,
        element.placeholder,
        element.getAttribute('aria-label') || '',
      ].join(' ').toLowerCase();
      if (type === 'password' || /password|passwd|passcode|contrase/.test(hint)) return 'password';
      if (type === 'email' || /email|e-mail|user|usuario|login|account|identifier|identifierid/.test(hint)) return 'username';
      return null;
    };

    const candidates = () => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((element) => visible(element) && !element.disabled && !element.readOnly);
      return {
        usernameInput: inputs.find((element) => fieldKind(element) === 'username') || null,
        passwordInput: inputs.find((element) => fieldKind(element) === 'password') || null,
      };
    };

    const setNativeValue = (element, value) => {
      if (!element || !value) return false;
      try {
        try { element.focus({ preventScroll: true }); } catch {
          try { element.focus(); } catch {}
        }
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(element, value);
        else element.value = value;
        try {
          element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: String(value),
          }));
        } catch {
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        try { element.blur(); } catch {}
        return true;
      } catch {
        return false;
      }
    };

    const fillAvailable = () => {
      const values = candidates();
      if (values.usernameInput && !values.usernameInput.value && username) setNativeValue(values.usernameInput, username);
      if (values.passwordInput && !values.passwordInput.value && password) setNativeValue(values.passwordInput, password);
      return values;
    };

    const save = async (button, message) => {
      try {
        if (button) {
          button.disabled = true;
          button.textContent = 'Guardando...';
        }
        if (message) message.textContent = 'Capturando sesión completa...';

        let result = null;
        if (saveBinding && typeof globalThis[saveBinding] === 'function') {
          result = await globalThis[saveBinding]({ href: location.href });
        } else if (controlUrl && controlSecret) {
          const response = await fetch(controlUrl + '/save', {
            method: 'POST',
            mode: 'cors',
            cache: 'no-store',
            headers: {
              'content-type': 'application/json',
              'x-userflex-secret': controlSecret,
            },
            body: JSON.stringify({ href: location.href }),
          });
          const responseText = await response.text();
          try { result = responseText ? JSON.parse(responseText) : {}; } catch { result = { error: responseText }; }
          if (!response.ok) throw new Error(result?.error || ('HTTP ' + response.status));
        } else {
          throw new Error('El control de captura no está disponible.');
        }

        if (result?.error) throw new Error(result.error);
        if (button) button.textContent = 'Guardada · v' + (result?.version || '?');
        if (message) {
          const cookies = Number(result?.cookieCount || 0);
          const idb = Number(result?.indexedDbCount || 0);
          message.textContent = 'Perfil guardado: ' + cookies + ' cookies, ' + idb + ' bases IndexedDB.';
        }
      } catch (error) {
        if (button) {
          button.disabled = false;
          button.textContent = 'Guardar ahora';
        }
        if (message) message.textContent = error?.message || String(error || 'No se pudo guardar la sesión.');
      }
    };

    const ensureOverlay = () => {
      if (!document.documentElement) return null;
      const current = document.getElementById('userflex-session-overlay');
      if (current) return current;

      const host = document.createElement('div');
      host.id = 'userflex-session-overlay';
      host.style.cssText = [
        'position:fixed',
        'left:18px',
        'bottom:18px',
        'z-index:2147483647',
        'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      ].join(';');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .wrap {
            min-width:260px; max-width:340px; padding:10px 12px;
            border:1px solid rgba(99,102,241,.5); border-radius:12px;
            background:rgba(15,23,42,.96); color:#fff;
            box-shadow:0 12px 34px rgba(0,0,0,.35);
            font:600 12px/1.25 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          }
          .title { font-weight:800; color:#c4b5fd; margin-bottom:7px; }
          .row { display:flex; gap:6px; flex-wrap:wrap; }
          button {
            appearance:none; border:0; border-radius:7px; padding:6px 9px;
            cursor:pointer; background:#312e81; color:white; font:700 11px/1 system-ui;
          }
          button.secondary { background:#334155; }
          button:disabled { opacity:.65; cursor:default; }
          .msg { margin-top:7px; color:#cbd5e1; font-weight:500; max-width:310px; }
        </style>
        <div class="wrap">
          <div class="title">userFLEX · Captura</div>
          <div class="row">
            <button type="button" data-kind="username" class="secondary">Email</button>
            <button type="button" data-kind="password" class="secondary">Password</button>
            <button type="button" data-kind="save">Guardar ahora</button>
          </div>
          <div class="msg">Guardado automático activo. Completa cualquier 2FA/CAPTCHA; si Chromium no se cierra, pulsa Guardar ahora.</div>
        </div>
      `;
      document.documentElement.appendChild(host);
      const message = shadow.querySelector('.msg');
      shadow.querySelector('[data-kind="username"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const values = fillAvailable();
        if (values.usernameInput && username) setNativeValue(values.usernameInput, username);
        if (message) message.textContent = values.usernameInput ? 'Email aplicado.' : 'Aún no aparece el campo de email.';
      });
      shadow.querySelector('[data-kind="password"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const values = fillAvailable();
        if (values.passwordInput && password) setNativeValue(values.passwordInput, password);
        if (message) message.textContent = values.passwordInput ? 'Password aplicado.' : 'Aún no aparece el campo de contraseña.';
      });
      const saveButton = shadow.querySelector('[data-kind="save"]');
      saveButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void save(saveButton, message);
      });
      return host;
    };

    const refresh = () => {
      try { ensureOverlay(); } catch {}
      try { fillAvailable(); } catch {}
    };
    globalThis[GLOBAL_KEY] = { refresh };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'name', 'id', 'autocomplete', 'placeholder', 'aria-label', 'style', 'class'],
    });
    const retryTimer = setInterval(refresh, 750);
    setTimeout(() => {
      try { clearInterval(retryTimer); } catch {}
      try { observer.disconnect(); } catch {}
    }, 900000);
    addEventListener('focusin', refresh, true);
    addEventListener('pageshow', refresh, true);
    for (const delayMs of [80, 200, 500, 1000, 2000, 4000, 8000]) setTimeout(refresh, delayMs);
  };

  const chatgptRecoveryState = new WeakMap();
  const chatgptAdvanceState = new WeakMap();

  const openAiAuthPage = (rawUrl) => {
    try {
      const value = new URL(String(rawUrl || ''));
      return (value.hostname === 'chatgpt.com' && value.pathname.startsWith('/auth/'))
        || value.hostname === 'auth.openai.com';
    } catch {
      return false;
    }
  };

  const openAiManualVerificationPage = (rawUrl) => {
    try {
      const value = new URL(String(rawUrl || ''));
      const host = value.hostname.toLowerCase();
      const pathname = value.pathname.toLowerCase();
      if (host !== 'auth.openai.com' && !host.endsWith('.auth.openai.com')) return false;
      if (pathname.startsWith('/api/accounts/authorize')) return true;
      return /(?:^|\/)(?:email-verification|verification|verify|challenge|mfa|otp|one-time|code)(?:\/|$)/i.test(pathname);
    } catch {
      return false;
    }
  };

  const pageLooksLikeBlankChatgptAuth = async (page) => {
    try {
      return await page.evaluate(() => {
        const overlay = document.getElementById('userflex-session-overlay');
        const visible = (element) => {
          try {
            if (overlay && (element === overlay || overlay.contains(element))) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || 1) !== 0
              && rect.width > 0
              && rect.height > 0;
          } catch {
            return false;
          }
        };
        const meaningful = Array.from(document.querySelectorAll(
          'main,form,input,h1,h2,[role="main"],[role="dialog"],button,a',
        )).some((element) => visible(element));
        const bodyText = String(document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();
        return !meaningful && bodyText.length < 16;
      });
    } catch {
      return false;
    }
  };

  const recoverBlankChatgptAuth = async (page) => {
    if (!page) return;
    let current = null;
    try { current = new URL(page.url()); } catch { return; }
    if (current.hostname !== 'chatgpt.com' || current.pathname !== '/auth/login_with') return;

    const previous = chatgptRecoveryState.get(page) || { href: '', attempts: 0, lastAttemptAt: 0 };
    const sameHref = previous.href === current.href;
    if (sameHref && previous.attempts >= 2) return;
    if (Date.now() - Number(previous.lastAttemptAt || 0) < 2_500) return;

    await delay(2_500);
    try {
      const afterWait = new URL(page.url());
      if (afterWait.hostname !== 'chatgpt.com' || afterWait.pathname !== '/auth/login_with') return;
      current = afterWait;
    } catch { return; }
    if (!await pageLooksLikeBlankChatgptAuth(page)) return;

    const attempts = sameHref ? previous.attempts + 1 : 1;
    chatgptRecoveryState.set(page, {
      href: current.href,
      attempts,
      lastAttemptAt: Date.now(),
    });

    if (attempts === 1) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      return;
    }

    // Keep the username hint when falling back to the stable ChatGPT login
    // entry point. The native advance helper below will press Continue again.
    const loginHint = current.searchParams.get('login_hint') || String(payload.username || '').trim();
    const fallback = new URL('https://chatgpt.com/auth/login');
    fallback.searchParams.set('callback_path', current.searchParams.get('callback_path') || '/');
    if (loginHint) fallback.searchParams.set('login_hint', loginHint);
    await page.goto(fallback.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(() => null);
  };

  const nativeAdvanceOpenAiUsername = async (page) => {
    if (!page || !openAiAuthPage(page.url())) return false;

    const fillVisiblePassword = async () => {
      if (!payload.password) return false;
      let passwordHandle = null;
      try {
        passwordHandle = await page.evaluateHandle(() => {
          const visible = (element) => {
            try {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity || 1) !== 0
                && rect.width > 0
                && rect.height > 0;
            } catch {
              return false;
            }
          };
          return Array.from(document.querySelectorAll('input')).find((element) => {
            if (!visible(element) || element.disabled || element.readOnly) return false;
            const type = String(element.type || '').toLowerCase();
            const hint = [
              type,
              element.name,
              element.id,
              element.autocomplete,
              element.placeholder,
              element.getAttribute('aria-label') || '',
            ].join(' ').toLowerCase();
            return type === 'password' || /password|passwd|passcode|contrase/.test(hint);
          }) || null;
        });
        const passwordInput = passwordHandle?.asElement?.();
        if (!passwordInput) return false;
        const currentValue = await passwordInput.evaluate((element) => String(element.value || ''));
        if (currentValue) return true;
        await passwordInput.click({ clickCount: 3 }).catch(() => null);
        await page.keyboard.press('Control+A').catch(() => null);
        await page.keyboard.type(String(payload.password), { delay: 24 });
        return true;
      } catch {
        return false;
      } finally {
        if (passwordHandle && typeof passwordHandle.dispose === 'function') {
          await passwordHandle.dispose().catch(() => null);
        }
      }
    };

    if (await fillVisiblePassword()) return true;
    if (!payload.username) return false;

    const href = page.url();
    const previous = chatgptAdvanceState.get(page) || { key: '', attempts: 0, lastAttemptAt: 0 };
    const key = href + '|' + String(payload.username).trim().toLowerCase();
    if (previous.key === key && previous.attempts >= 3) return false;
    if (previous.key === key && Date.now() - Number(previous.lastAttemptAt || 0) < 1_500) return false;

    let usernameHandle = null;
    let actionHandle = null;
    try {
      usernameHandle = await page.evaluateHandle(() => {
        const visible = (element) => {
          try {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || 1) !== 0
              && rect.width > 0
              && rect.height > 0;
          } catch {
            return false;
          }
        };
        return Array.from(document.querySelectorAll('input')).find((element) => {
          if (!visible(element) || element.disabled || element.readOnly) return false;
          const type = String(element.type || '').toLowerCase();
          const hint = [
            type,
            element.name,
            element.id,
            element.autocomplete,
            element.placeholder,
            element.getAttribute('aria-label') || '',
          ].join(' ').toLowerCase();
          return type === 'email' || /email|e-mail|user|usuario|login|account|identifier|identifierid/.test(hint);
        }) || null;
      });

      const usernameInput = usernameHandle?.asElement?.();
      if (!usernameInput) return false;
      let currentValue = await usernameInput.evaluate((element) => String(element.value || '').trim());
      if (!currentValue) {
        await usernameInput.click({ clickCount: 3 }).catch(() => null);
        await page.keyboard.press('Control+A').catch(() => null);
        await page.keyboard.type(String(payload.username), { delay: 24 });
        currentValue = String(payload.username).trim();
      }
      if (currentValue.toLowerCase() !== String(payload.username).trim().toLowerCase()) return false;

      actionHandle = await page.evaluateHandle((usernameElement) => {
        const visible = (element) => {
          try {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || 1) !== 0
              && rect.width > 0
              && rect.height > 0;
          } catch {
            return false;
          }
        };
        const label = (element) => String(
          element?.textContent
          || element?.value
          || element?.getAttribute?.('aria-label')
          || element?.getAttribute?.('title')
          || '',
        ).replace(/\s+/g, ' ').trim().toLowerCase();
        const root = usernameElement?.form || document;
        const actions = Array.from(root.querySelectorAll('button,input[type="submit"],[role="button"]'))
          .filter((element) => visible(element) && !element.disabled);
        return actions.find((element) => /^(continue|next|continuar|siguiente)$/.test(label(element)))
          || actions.find((element) => element instanceof HTMLInputElement && element.type === 'submit')
          || null;
      }, usernameInput);

      const action = actionHandle?.asElement?.();
      if (!action) return false;

      const attempts = previous.key === key ? previous.attempts + 1 : 1;
      chatgptAdvanceState.set(page, { key, attempts, lastAttemptAt: Date.now() });

      await action.click({ delay: 80 }).catch(async () => {
        await page.keyboard.press('Enter').catch(() => null);
      });

      await page.waitForFunction(
        (startHref) => {
          if (location.href !== startHref) return true;
          return Array.from(document.querySelectorAll('input')).some((element) => {
            const type = String(element.type || '').toLowerCase();
            const hint = [
              type,
              element.name,
              element.id,
              element.autocomplete,
              element.placeholder,
              element.getAttribute('aria-label') || '',
            ].join(' ').toLowerCase();
            return type === 'password' || /password|passwd|passcode|contrase/.test(hint);
          });
        },
        { timeout: 12_000 },
        href,
      ).catch(() => null);

      await fillVisiblePassword();
      return true;
    } catch {
      return false;
    } finally {
      if (usernameHandle && typeof usernameHandle.dispose === 'function') {
        await usernameHandle.dispose().catch(() => null);
      }
      if (actionHandle && typeof actionHandle.dispose === 'function') {
        await actionHandle.dispose().catch(() => null);
      }
    }
  };

  const prepared = new WeakSet();
  const instrument = async (page) => {
    if (!page) return;
    try {
      const canonicalUrl = canonicalGoogleAccountsUrl(page.url());
      if (canonicalUrl) {
        await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
      }
      if (!prepared.has(page)) {
        prepared.add(page);
        if (typeof onSave === 'function' && payload.saveBinding) {
          await page.exposeFunction(payload.saveBinding, async (request) => onSave(request || {})).catch(() => null);
        }
        await page.evaluateOnNewDocument(bootstrap, payload);
      }
      const openAiAuth = openAiAuthPage(page.url());
      const openAiManualVerification = openAiManualVerificationPage(page.url());
      if (!openAiAuth && credentialAutofillAllowsUrl(page.url(), allowedOrigins)) {
        await page.evaluate(bootstrap, payload);
      }
      if (openAiAuth && !openAiManualVerification) {
        void nativeAdvanceOpenAiUsername(page).finally(() => recoverBlankChatgptAuth(page));
      } else {
        void recoverBlankChatgptAuth(page);
      }
    } catch {}
  };

  const onTarget = async (target) => {
    try {
      if (target.type() !== 'page') return;
      await instrument(await target.page());
    } catch {}
  };

  browser.on('targetcreated', onTarget);
  browser.on('targetchanged', onTarget);

  const pages = await browser.pages();
  await Promise.all(pages.map(instrument));

  return {
    installed: true,
    allowedOrigins,
    cleanup() {
      try { browser.off('targetcreated', onTarget); } catch {}
      try { browser.off('targetchanged', onTarget); } catch {}
    },
  };
}

export async function capturePortableSession({ debugPort, profile, networkMode = 'direct' }) {
  const target = captureNavigationTarget(profile.url);
  const browser = await connectCaptureBrowser(debugPort);
  try {
    const page = await pageForOrigin(browser, target);
    const pageState = await validateCapturePage(page, target);
    const cookiesRaw = await allCookies(page);
    const cookies = cookiesRaw
      .filter((cookie) => cookie?.name && cookieRelevantToTarget(cookie.domain, target.hostname))
      .map(normalizeCookie);

    if (isNetflixHost(target.hostname)) {
      const names = new Set(cookies.map((cookie) => cookie.name.toLowerCase()));
      const missing = ['netflixid', 'securenetflixid'].filter((name) => !names.has(name));
      if (missing.length) {
        throw new Error('Netflix todavía no expuso las cookies de autenticación activas. Confirma que la cuenta esté abierta y vuelve a guardar.');
      }
    }

    if (isGoogleFlowHost(target.hostname)) {
      const hasGoogleAuth = cookies.some((cookie) => isGoogleAuthCookieName(cookie.name) && String(cookie.value || ''));
      if (!hasGoogleAuth) {
        throw new Error('Google Flow todavía no expuso cookies de autenticación activas. Confirma que la cuenta esté abierta antes de guardar.');
      }
    }

    const storage = await readWebStorageAndIndexedDb(page);
    const browserIdentity = {
      product: await browser.version().catch(() => null),
      userAgent: await browser.userAgent().catch(() => null),
      platform: await page.evaluate(() => navigator.platform || '').catch(() => ''),
      language: await page.evaluate(() => navigator.language || '').catch(() => ''),
    };
    const rawIndexedDb = JSON.stringify(storage.indexedDB || []);
    const packedIndexedDb = gzipSync(Buffer.from(rawIndexedDb, 'utf8'), { level: 9 }).toString('base64');

    return {
      material: {
        format: 'userflex-browser-session-v2',
        profileId: profile.id,
        allowedOrigin: target.origin,
        capturedUrl: pageState.href,
        capturedAt: new Date().toISOString(),
        network: { mode: networkMode },
        browser: browserIdentity,
        cookies,
        storage: {
          origin: storage.origin,
          href: storage.href,
          localStorage: storage.localStorage,
          sessionStorage: storage.sessionStorage,
          indexedDBCompressed: {
            encoding: 'gzip+base64',
            data: packedIndexedDb,
            uncompressedBytes: Buffer.byteLength(rawIndexedDb, 'utf8'),
            databaseCount: Array.isArray(storage.indexedDB) ? storage.indexedDB.length : 0,
          },
        },
      },
      diagnostics: {
        cookieCount: cookies.length,
        indexedDbCount: Array.isArray(storage.indexedDB) ? storage.indexedDB.length : 0,
        indexedDbBytes: Buffer.byteLength(rawIndexedDb, 'utf8'),
        currentUrl: pageState.href,
      },
    };
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function inspectCaptureSession(debugPort, profileUrl, options = {}) {
  const browser = await connectCaptureBrowser(debugPort);
  try {
    const target = captureNavigationTarget(profileUrl);
    let pages = await browser.pages();
    let page = null;

    for (const candidate of pages) {
      try {
        const current = new URL(candidate.url());
        if (current.origin === target.origin) {
          page = candidate;
          break;
        }
        const googleAuth = target.hostname.endsWith('.google.com')
          && (current.hostname === 'accounts.google.com' || /^accounts\.google\./i.test(current.hostname));
        if (!page && googleAuth) page = candidate;
      } catch {}
    }

    if (!page) {
      if (options?.navigateIfMissing === false) {
        return {
          href: pages[0]?.url?.() || '',
          hostname: '',
          pathname: '',
          usernameFieldVisible: false,
          passwordFieldVisible: false,
          loginActionVisible: false,
          meaningfulContent: false,
          readyState: 'loading',
          loginLikeUrl: true,
          targetOriginMatched: false,
          authenticated: false,
        };
      }
      page = pages.find((item) => item.url() === 'about:blank') || pages[0] || await browser.newPage();
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const state = await page.evaluate(() => {
      const visible = (element) => {
        try {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) !== 0
            && rect.width > 0
            && rect.height > 0;
        } catch {
          return false;
        }
      };
      const inputs = Array.from(document.querySelectorAll('input')).filter((element) => visible(element));
      const passwordFieldVisible = inputs.some((element) => {
        const hint = [
          element.type,
          element.name,
          element.id,
          element.autocomplete,
          element.placeholder,
          element.getAttribute('aria-label') || '',
        ].join(' ').toLowerCase();
        return element.type === 'password' || /password|passwd|passcode|contrase/.test(hint);
      });
      const usernameFieldVisible = inputs.some((element) => {
        const hint = [
          element.type,
          element.name,
          element.id,
          element.autocomplete,
          element.placeholder,
          element.getAttribute('aria-label') || '',
        ].join(' ').toLowerCase();
        return element.type === 'email' || /email|e-mail|user|usuario|login|account|identifier/.test(hint);
      });
      const loginActionVisible = Array.from(document.querySelectorAll('a,button,[role="button"]'))
        .filter((element) => visible(element))
        .some((element) => {
          const label = String(
            element.textContent
            || element.getAttribute('aria-label')
            || element.getAttribute('title')
            || '',
          ).replace(/\s+/g, ' ').trim().toLowerCase();
          return /^(log in|login|sign in|signin|iniciar sesi[oó]n|acceder|entrar)$/.test(label);
        });
      const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const meaningfulContent = bodyText.length >= 24
        || Array.from(document.querySelectorAll('main,[role="main"],article,section,nav'))
          .some((element) => visible(element));
      return {
        href: location.href,
        hostname: location.hostname,
        pathname: location.pathname,
        usernameFieldVisible,
        passwordFieldVisible,
        loginActionVisible,
        meaningfulContent,
        readyState: document.readyState,
      };
    }).catch(() => ({
      href: page.url(),
      hostname: '',
      pathname: '',
      usernameFieldVisible: false,
      passwordFieldVisible: false,
      loginActionVisible: false,
      meaningfulContent: false,
      readyState: 'loading',
    }));

    let current;
    try { current = new URL(state.href || page.url()); } catch { current = target; }
    const path = String(current.pathname || '').toLowerCase();
    const netflixTarget = isNetflixHost(target.hostname);
    const loginLikeUrl = current.hostname === 'accounts.google.com'
      || /^accounts\.google\./i.test(current.hostname)
      || /\/(?:login|signin|sign-in|auth|account\/login|servicelogin)(?:\/|$)/i.test(path)
      || (netflixTarget && (path.startsWith('/login') || path.startsWith('/signup')));

    const targetOriginMatched = current.origin === target.origin;
    let netflixAuthCookies = null;
    let netflixAppPath = null;
    if (netflixTarget) {
      const cookieNames = new Set(
        (await allCookies(page).catch(() => []))
          .filter((cookie) => cookie?.name && domainMatches(cookie.domain, target.hostname))
          .map((cookie) => String(cookie.name || '').toLowerCase()),
      );
      netflixAuthCookies = cookieNames.has('netflixid') && cookieNames.has('securenetflixid');
      netflixAppPath = isNetflixAuthenticatedAppPath(path);
    }

    const genericAuthenticated = targetOriginMatched
      && state.meaningfulContent === true
      && state.readyState !== 'loading'
      && !loginLikeUrl
      && state.usernameFieldVisible !== true
      && state.passwordFieldVisible !== true
      && state.loginActionVisible !== true;

    const authenticated = netflixTarget
      ? targetOriginMatched
        && state.meaningfulContent === true
        && state.readyState !== 'loading'
        && !loginLikeUrl
        && netflixAuthCookies === true
        && netflixAppPath === true
        && state.passwordFieldVisible !== true
        && state.loginActionVisible !== true
      : genericAuthenticated;

    return {
      ...state,
      loginLikeUrl,
      targetOriginMatched,
      netflixTarget,
      netflixAuthCookies,
      netflixAppPath,
      authenticated,
    };
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function navigateCaptureHome(debugPort, profileUrl) {
  const browser = await connectCaptureBrowser(debugPort);
  try {
    const target = captureNavigationTarget(profileUrl);
    const page = await pageForOrigin(browser, target);
    if (page.url() !== target.toString()) {
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }

    const pages = await browser.pages();
    for (const extra of pages) {
      if (extra === page) continue;
      await extra.close().catch(() => null);
    }
    await page.bringToFront().catch(() => null);
    return true;
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function closeDevtoolsTargets(debugPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return;
    const targets = await response.json();
    for (const target of Array.isArray(targets) ? targets : []) {
      if (!String(target?.url || '').startsWith('devtools://') || !target?.id) continue;
      await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(target.id)}`).catch(() => null);
    }
  } catch {}
}
