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

export async function restorePortableSession({ debugPort, profileUrl, profileId = null, material }) {
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

    // Netflix authentication is portable through its auth cookies, but copying
    // browser storage from the Session Manager device can also copy stale
    // device/session state. That was the production cause of Netflix treating a
    // freshly restored session as expired. For Netflix, let this local Chrome
    // profile establish its own storage/IDB after the cookies are installed.
    // Other managed sites keep the full portable v1/v2 storage restore.
    const restoreCapturedStorage = !isNetflixTarget(target);
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
      storagePolicy: restoreCapturedStorage ? 'portable-full' : 'netflix-local-device',
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
