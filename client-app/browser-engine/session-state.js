import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

function normalizeSameSite(value) {
  switch (String(value || '').toLowerCase()) {
    case 'none':
    case 'no_restriction':
      return 'None';
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    default:
      return undefined;
  }
}

function flattenCookies(material) {
  const cookies = Array.isArray(material?.cookies) ? material.cookies : [];
  return cookies.filter((cookie) => cookie && cookie.name && cookie.value !== undefined);
}

async function applyCookies(browser, cookies) {
  let installed = 0;
  const rejected = [];
  for (const cookie of cookies) {
    try {
      const sameSite = normalizeSameSite(cookie.sameSite);
      const secure = sameSite === 'None' ? true : cookie.secure !== false;
      const cookiePath = cookie.path || '/';
      const domain = String(cookie.domain || '').trim();
      const host = domain.replace(/^\./, '');
      const payload = {
        name: String(cookie.name),
        value: String(cookie.value ?? ''),
        path: cookiePath,
        secure,
        httpOnly: cookie.httpOnly === true,
      };
      if (cookie.hostOnly === true && host) {
        payload.url = `${secure ? 'https:' : 'http:'}//${host}${cookiePath}`;
      } else if (domain) {
        payload.domain = domain;
      }
      if (sameSite) payload.sameSite = sameSite;
      const expires = Number(cookie.expires ?? cookie.expirationDate);
      if (Number.isFinite(expires) && expires > 0) payload.expires = expires;
      await browser.setCookie(payload);
      installed += 1;
    } catch (error) {
      rejected.push({
        name: String(cookie?.name || ''),
        reason: error instanceof Error ? error.message : String(error || ''),
      });
    }
  }
  return { installed, rejected };
}

function cookieDomainMatchesHost(cookie, hostname) {
  const host = String(hostname || '').toLowerCase();
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  return Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
}

function isNetflixTarget(target) {
  const hostname = String(target?.hostname || '').toLowerCase();
  return hostname === 'netflix.com' || hostname.endsWith('.netflix.com');
}

async function verifyFirstPartyAuthCookies(page, target, capturedCookies) {
  if (!isNetflixTarget(target)) return;

  const expected = new Map(
    capturedCookies
      .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname))
      .filter((cookie) => ['netflixid', 'securenetflixid'].includes(String(cookie.name || '').toLowerCase()))
      .map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value ?? '')]),
  );
  if (!expected.size) return;

  const client = await page.createCDPSession();
  try {
    const result = await client.send('Storage.getCookies');
    const installed = new Map(
      (Array.isArray(result?.cookies) ? result.cookies : [])
        .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname))
        .map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value ?? '')]),
    );
    const missing = [];
    for (const [name] of expected) {
      if (!installed.has(name) || !installed.get(name)) missing.push(name);
    }
    if (missing.length) {
      throw new Error(`Chrome no pudo conservar las cookies de autenticación de Netflix: ${missing.join(', ')}.`);
    }
  } finally {
    await client.detach().catch(() => null);
  }
}

function compressedIndexedDb(storage) {
  const packed = storage?.indexedDBCompressed;
  if (!packed || packed.encoding !== 'gzip+base64' || typeof packed.data !== 'string') return [];
  try {
    const raw = gunzipSync(Buffer.from(packed.data, 'base64')).toString('utf8');
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storagePayload(material) {
  const storage = material?.storage && typeof material.storage === 'object' ? material.storage : {};
  const indexedDB = Array.isArray(storage.indexedDB)
    ? storage.indexedDB
    : Array.isArray(material?.indexedDB)
      ? material.indexedDB
      : compressedIndexedDb(storage);
  return {
    origin: typeof storage.origin === 'string' ? storage.origin : null,
    localStorage: storage.localStorage && typeof storage.localStorage === 'object' ? storage.localStorage : {},
    sessionStorage: storage.sessionStorage && typeof storage.sessionStorage === 'object' ? storage.sessionStorage : {},
    indexedDB,
  };
}

function installStorageScript(page, targetOrigin, state) {
  return page.evaluateOnNewDocument(({ origin, localData, sessionData, indexedDBData }) => {
    if (location.origin !== origin) return;

    const decode = (node) => {
      if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, '__ufType')) {
        if (Array.isArray(node)) return node.map(decode);
        if (node && typeof node === 'object') {
          const out = {};
          for (const [key, value] of Object.entries(node)) out[key] = decode(value);
          return out;
        }
        return node;
      }
      switch (node.__ufType) {
        case 'undefined': return undefined;
        case 'bigint': return BigInt(node.value);
        case 'date': return new Date(node.value);
        case 'arraybuffer': {
          const binary = atob(node.value || '');
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          return bytes.buffer;
        }
        case 'typedarray': {
          const binary = atob(node.value || '');
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const ctor = globalThis[node.name] || Uint8Array;
          try { return new ctor(bytes.buffer); } catch { return bytes; }
        }
        case 'blob':
        case 'file': {
          const binary = atob(node.value || '');
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          if (node.__ufType === 'file' && typeof File !== 'undefined') {
            try { return new File([bytes], node.name || 'file', { type: node.type || '', lastModified: Number(node.lastModified || Date.now()) }); } catch {}
          }
          try { return new Blob([bytes], { type: node.type || '' }); } catch { return bytes; }
        }
        case 'map':
          return new Map((node.value || []).map(([key, value]) => [decode(key), decode(value)]));
        case 'set':
          return new Set((node.value || []).map(decode));
        default: return node.value;
      }
    };

    try {
      for (const [key, value] of Object.entries(localData || {})) localStorage.setItem(key, String(value));
    } catch {}
    try {
      for (const [key, value] of Object.entries(sessionData || {})) sessionStorage.setItem(key, String(value));
    } catch {}

    const restoreDatabase = (snapshot) => new Promise((resolve) => {
      if (!snapshot?.name) return resolve(false);
      let deleteRequest;
      try { deleteRequest = indexedDB.deleteDatabase(snapshot.name); } catch { return resolve(false); }
      const afterDelete = () => {
        let request;
        try { request = indexedDB.open(snapshot.name, Math.max(1, Number(snapshot.version || 1))); } catch { return resolve(false); }
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const schema of snapshot.stores || []) {
            let store;
            try {
              store = db.createObjectStore(schema.name, {
                keyPath: schema.keyPath ?? null,
                autoIncrement: schema.autoIncrement === true,
              });
            } catch {
              try { store = request.transaction.objectStore(schema.name); } catch { continue; }
            }
            for (const index of schema.indexes || []) {
              try {
                store.createIndex(index.name, index.keyPath, {
                  unique: index.unique === true,
                  multiEntry: index.multiEntry === true,
                });
              } catch {}
            }
          }
        };
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          const db = request.result;
          const names = Array.from(db.objectStoreNames);
          if (!names.length) {
            db.close();
            resolve(true);
            return;
          }
          let tx;
          try { tx = db.transaction(names, 'readwrite'); } catch {
            db.close();
            resolve(false);
            return;
          }
          for (const schema of snapshot.stores || []) {
            if (!names.includes(schema.name)) continue;
            const store = tx.objectStore(schema.name);
            for (const record of schema.records || []) {
              try {
                const value = decode(record.value);
                if (store.keyPath == null && record.primaryKey !== undefined) store.put(value, decode(record.primaryKey));
                else store.put(value);
              } catch {}
            }
          }
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            resolve(false);
          };
          tx.onabort = tx.onerror;
        };
      };
      deleteRequest.onsuccess = afterDelete;
      deleteRequest.onerror = afterDelete;
      deleteRequest.onblocked = afterDelete;
    });

    globalThis.__userflexSessionRestore = Promise.all((indexedDBData || []).map(restoreDatabase))
      .then((results) => ({ restored: results.filter(Boolean).length, total: results.length }))
      .catch(() => ({ restored: 0, total: (indexedDBData || []).length }));
  }, {
    origin: targetOrigin,
    localData: state.localStorage,
    sessionData: state.sessionStorage,
    indexedDBData: state.indexedDB,
  });
}

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

export async function connectKaizenBrowser(debugPort) {
  const ready = await waitForDevtools(debugPort);
  if (!ready) throw new Error('El navegador del perfil no abrió su puerto de control.');
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${debugPort}`,
    defaultViewport: null,
  });
}

export async function installCredentialAutofill({ debugPort, profileUrl, credentials }) {
  if (!credentials?.username || !credentials?.password) return { installed: false };
  const target = new URL(profileUrl);
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const bootstrap = ({ allowedProtocol, allowedRootHost, username, password }) => {
      const currentRootHost = String(location.hostname || '').toLowerCase().replace(/^www\./, '');
      if (location.protocol !== allowedProtocol || currentRootHost !== allowedRootHost) return;

      const HELPER_ID = '__userflex-credential-helper';
      let dismissed = false;
      let helperHost = null;
      let helperMessage = null;

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
        if (type === 'password' || /password|passcode|contrase/.test(hint)) return 'password';
        if (type === 'email' || /email|e-mail|user|usuario|login|account|identifier/.test(hint)) return 'username';
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
        if (!element) return false;
        try {
          const proto = HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) descriptor.set.call(element, value);
          else element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        } catch {
          return false;
        }
      };

      const focusWithoutJump = (element) => {
        if (!element) return;
        try { element.focus({ preventScroll: true }); } catch {
          try { element.focus(); } catch {}
        }
      };

      const setMessage = (text) => {
        if (helperMessage) helperMessage.textContent = text;
      };

      const fillField = (kind, focus = false) => {
        const { usernameInput, passwordInput } = candidates();
        const element = kind === 'password' ? passwordInput : usernameInput;
        const value = kind === 'password' ? password : username;
        if (!element) {
          setMessage(kind === 'password' ? 'Abre el paso de contraseña' : 'No se encontró el campo de email');
          return false;
        }
        const changed = !element.value ? setNativeValue(element, value) : true;
        if (focus) focusWithoutJump(element);
        setMessage(changed ? 'Credencial aplicada' : 'No se pudo completar este campo');
        return changed;
      };

      const ensureHelper = () => {
        if (dismissed || !document.documentElement) return null;
        if (helperHost?.isConnected) return helperHost;

        helperHost = document.getElementById(HELPER_ID);
        if (!helperHost) {
          helperHost = document.createElement('div');
          helperHost.id = HELPER_ID;
          helperHost.style.cssText = [
            'position:fixed',
            'z-index:2147483647',
            'display:none',
            'pointer-events:auto',
            'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          ].join(';');
          document.documentElement.appendChild(helperHost);
        }

        const shadow = helperHost.shadowRoot || helperHost.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
          <style>
            :host { all: initial; }
            .uf-wrap {
              display:flex; align-items:center; gap:5px; padding:4px 6px;
              border:1px solid rgba(99,102,241,.45); border-radius:9px;
              background:rgba(20,18,38,.96); color:#fff;
              box-shadow:0 8px 24px rgba(0,0,0,.28);
              font:600 11px/1.15 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
              white-space:nowrap; user-select:none;
            }
            .uf-brand { color:#c4b5fd; font-size:10px; font-weight:800; letter-spacing:.04em; padding:0 2px; }
            button {
              all:unset; box-sizing:border-box; cursor:pointer; border-radius:6px;
              padding:4px 8px; background:#312e52; color:#ede9fe;
              font:700 10px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            }
            button:hover { background:#4338ca; color:white; }
            button:focus-visible { outline:2px solid #a5b4fc; outline-offset:1px; }
            .uf-close { padding:4px 6px; background:transparent; color:#cbd5e1; font-size:13px; }
            .uf-msg { display:none; max-width:180px; overflow:hidden; text-overflow:ellipsis; color:#cbd5e1; font-weight:500; }
          </style>
          <div class="uf-wrap" role="group" aria-label="userFLOW autofill">
            <span class="uf-brand">userFLOW</span>
            <button type="button" data-kind="username">Email</button>
            <button type="button" data-kind="password">Password</button>
            <span class="uf-msg" aria-live="polite"></span>
            <button type="button" class="uf-close" aria-label="Cerrar">×</button>
          </div>
        `;

        helperMessage = shadow.querySelector('.uf-msg');
        shadow.querySelector('[data-kind="username"]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          fillField('username', true);
        });
        shadow.querySelector('[data-kind="password"]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          fillField('password', true);
        });
        shadow.querySelector('.uf-close')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dismissed = true;
          try { helperHost.remove(); } catch {}
          helperHost = null;
          helperMessage = null;
        });
        return helperHost;
      };

      const positionHelper = () => {
        if (dismissed) return;
        const { usernameInput, passwordInput } = candidates();
        const active = document.activeElement instanceof HTMLInputElement && fieldKind(document.activeElement)
          ? document.activeElement
          : null;
        const anchor = active || usernameInput || passwordInput;
        if (!anchor) {
          if (helperHost) helperHost.style.display = 'none';
          return;
        }

        const host = ensureHelper();
        if (!host) return;
        const rect = anchor.getBoundingClientRect();
        const topAbove = rect.top - 36;
        const top = topAbove >= 6 ? topAbove : Math.min(window.innerHeight - 34, rect.bottom + 6);
        const left = Math.max(6, Math.min(rect.left, window.innerWidth - 260));
        host.style.left = `${Math.round(left)}px`;
        host.style.top = `${Math.round(top)}px`;
        host.style.display = 'block';
      };

      const fillAvailable = () => {
        const { usernameInput, passwordInput } = candidates();
        if (usernameInput && !usernameInput.value) setNativeValue(usernameInput, username);
        if (passwordInput && !passwordInput.value) setNativeValue(passwordInput, password);
        positionHelper();
      };

      const start = () => {
        fillAvailable();

        const observer = new MutationObserver(() => {
          fillAvailable();
        });
        observer.observe(document.documentElement || document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['type', 'name', 'id', 'autocomplete', 'placeholder', 'style', 'class'],
        });

        addEventListener('focusin', () => {
          fillAvailable();
          requestAnimationFrame(positionHelper);
        }, true);
        addEventListener('scroll', () => requestAnimationFrame(positionHelper), true);
        addEventListener('resize', () => requestAnimationFrame(positionHelper), true);
        addEventListener('pageshow', () => {
          fillAvailable();
          requestAnimationFrame(positionHelper);
        });

        for (const delayMs of [100, 350, 800, 1500, 3000, 7000]) {
          setTimeout(fillAvailable, delayMs);
        }
      };

      if (document.documentElement) start();
      else addEventListener('DOMContentLoaded', start, { once: true });
    };
    const payload = {
      allowedProtocol: target.protocol,
      allowedRootHost: target.hostname.toLowerCase().replace(/^www\./, ''),
      username: String(credentials.username),
      password: String(credentials.password),
    };
    const existingPages = await browser.pages();
    const pages = existingPages.length ? existingPages : [await browser.newPage()];
    let immediatePages = 0;

    for (const page of pages) {
      await page.evaluateOnNewDocument(bootstrap, payload);
      try {
        const current = new URL(page.url());
        const currentRootHost = current.hostname.toLowerCase().replace(/^www\./, '');
        if (current.protocol === payload.allowedProtocol && currentRootHost === payload.allowedRootHost) {
          await page.evaluate(bootstrap, payload);
          immediatePages += 1;
        }
      } catch {}
    }

    return {
      installed: true,
      origin: target.origin,
      visibleHelper: true,
      pagesPrepared: pages.length,
      immediatePages,
    };
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function inspectRuntimeProfile({ debugPort, profileUrl }) {
  const target = new URL(profileUrl);
  const browser = await connectKaizenBrowser(debugPort);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const pages = await browser.pages();
    const page = pages.find((item) => {
      try { return new URL(item.url()).hostname.endsWith(target.hostname.replace(/^www\./, '')); } catch { return false; }
    }) || pages.find((item) => /^https?:/i.test(item.url())) || pages[0];
    if (!page) {
      return {
        currentUrl: null,
        loginLikeUrl: false,
        usernameFieldVisible: false,
        passwordFieldVisible: false,
        usernameFilled: false,
        passwordFilled: false,
        helperVisible: false,
      };
    }
    return await page.evaluate(() => {
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
        if (type === 'password' || /password|passcode|contrase/.test(hint)) return 'password';
        if (type === 'email' || /email|e-mail|user|usuario|login|account|identifier/.test(hint)) return 'username';
        return null;
      };
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((element) => visible(element) && !element.disabled && !element.readOnly);
      const username = inputs.find((element) => fieldKind(element) === 'username') || null;
      const password = inputs.find((element) => fieldKind(element) === 'password') || null;
      const href = location.href;
      return {
        currentUrl: href,
        loginLikeUrl: /(?:\/|^)(login|signin|sign-in|auth)(?:\/|\?|#|$)/i.test(location.pathname + location.search),
        usernameFieldVisible: Boolean(username),
        passwordFieldVisible: Boolean(password),
        usernameFilled: Boolean(username && String(username.value || '').length > 0),
        passwordFilled: Boolean(password && String(password.value || '').length > 0),
        helperVisible: Boolean(document.getElementById('__userflex-credential-helper')),
      };
    }).catch(() => ({
      currentUrl: page.url(),
      loginLikeUrl: /(?:\/|^)(login|signin|sign-in|auth)(?:\/|\?|#|$)/i.test(page.url()),
      usernameFieldVisible: false,
      passwordFieldVisible: false,
      usernameFilled: false,
      passwordFilled: false,
      helperVisible: false,
    }));
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function restorePortableSession({ debugPort, profileUrl, profileId = null, material, storageStrategy = 'portable-first-party' }) {
  if (!material || !['userflex-browser-session-v1', 'userflex-browser-session-v2'].includes(material.format)) {
    throw new Error('El material de sesión del perfil no es compatible con el motor KAIZEN.');
  }

  const target = new URL(profileUrl);
  if (profileId && material.profileId && material.profileId !== profileId) {
    throw new Error('La sesión entregada no pertenece a este perfil.');
  }
  if (material.allowedOrigin && material.allowedOrigin !== target.origin) {
    throw new Error('El origen de la sesión no coincide con la web del perfil.');
  }

  const browser = await connectKaizenBrowser(debugPort);
  try {
    const cookies = flattenCookies(material);
    const cookieResult = await applyCookies(browser, cookies);
    if (cookies.length > 0 && cookieResult.installed === 0) {
      throw new Error('Chrome rechazó todas las cookies de la sesión administrada.');
    }

    let pages = await browser.pages();
    let page = pages.find((item) => item.url() === 'about:blank') || pages[0];
    if (!page) page = await browser.newPage();

    // Storage restoration is a profile strategy, not a global behavior. Netflix
    // remains fail-safe: even if an administrator selects portable-first-party,
    // device-bound Netflix storage is never transplanted between machines.
    const requestedStorageStrategy = String(storageStrategy || 'portable-first-party');
    const effectiveStorageStrategy = isNetflixTarget(target) && requestedStorageStrategy !== 'cookies-only'
      ? 'netflix-local-device'
      : requestedStorageStrategy;
    const restoreCapturedStorage = effectiveStorageStrategy === 'portable-first-party';
    const state = restoreCapturedStorage
      ? storagePayload(material)
      : { origin: target.origin, localStorage: {}, sessionStorage: {}, indexedDB: [] };
    const stateOrigin = state.origin || target.origin;
    let indexedDb = { restored: 0, total: state.indexedDB.length };

    if (restoreCapturedStorage && stateOrigin === target.origin) {
      // Seed a synthetic document at the target origin before the real site is
      // allowed to execute. This gives Local/Session Storage and IndexedDB a
      // deterministic head start instead of racing Netflix/app JavaScript.
      const script = await installStorageScript(page, target.origin, state);
      let seeded = false;
      const intercept = async (request) => {
        try {
          const requestUrl = new URL(request.url());
          const isMain = request.isNavigationRequest() && request.frame() === page.mainFrame();
          if (!seeded && isMain && requestUrl.origin === target.origin) {
            seeded = true;
            await request.respond({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: '<!doctype html><meta charset="utf-8"><title>userFLEX</title>',
            });
            return;
          }
          await request.continue();
        } catch {
          try { await request.continue(); } catch {}
        }
      };

      await page.setRequestInterception(true);
      page.on('request', intercept);
      try {
        await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        indexedDb = await page.evaluate(async () => {
          const pending = globalThis.__userflexSessionRestore;
          return pending && typeof pending.then === 'function'
            ? await Promise.race([
              pending,
              new Promise((resolve) => setTimeout(() => resolve({ restored: 0, total: -1 }), 20_000)),
            ])
            : { restored: 0, total: 0 };
        }).catch(() => ({ restored: 0, total: state.indexedDB.length }));
      } finally {
        page.off('request', intercept);
        await page.setRequestInterception(false).catch(() => null);
        if (script?.identifier && typeof page.removeScriptToEvaluateOnNewDocument === 'function') {
          await page.removeScriptToEvaluateOnNewDocument(script.identifier).catch(() => null);
        }
      }
    }

    // Only now load the real application. Browser-owned profile state is in
    // place before its first-party scripts start.
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await verifyFirstPartyAuthCookies(page, target, cookies);

    for (const extra of pages) {
      if (extra === page) continue;
      try {
        if (/^(about:blank|chrome:\/\/newtab\/?)/i.test(extra.url())) await extra.close();
      } catch {}
    }

    return {
      cookiesInstalled: cookieResult.installed,
      cookiesRejected: cookieResult.rejected.length,
      indexedDbRestored: Number(indexedDb?.restored || 0),
      indexedDbTotal: Number(indexedDb?.total || 0),
      storagePolicy: effectiveStorageStrategy,
      pageUrl: page.url(),
    };
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function navigateBrowserHome(debugPort, profileUrl) {
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const pages = await browser.pages();
    const page = pages.find((item) => /^https?:/i.test(item.url())) || pages[0] || await browser.newPage();
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
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
