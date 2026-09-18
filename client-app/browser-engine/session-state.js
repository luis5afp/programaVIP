import { setTimeout as delay } from 'node:timers/promises';
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
      const payload = {
        name: String(cookie.name),
        value: String(cookie.value ?? ''),
        domain: cookie.domain || undefined,
        path: cookie.path || '/',
        secure: sameSite === 'None' ? true : cookie.secure !== false,
        httpOnly: cookie.httpOnly === true,
      };
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

function storagePayload(material) {
  const storage = material?.storage && typeof material.storage === 'object' ? material.storage : {};
  return {
    origin: typeof storage.origin === 'string' ? storage.origin : null,
    localStorage: storage.localStorage && typeof storage.localStorage === 'object' ? storage.localStorage : {},
    sessionStorage: storage.sessionStorage && typeof storage.sessionStorage === 'object' ? storage.sessionStorage : {},
    indexedDB: Array.isArray(storage.indexedDB)
      ? storage.indexedDB
      : Array.isArray(material?.indexedDB)
        ? material.indexedDB
        : [],
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

export async function restorePortableSession({ debugPort, profileUrl, material }) {
  if (!material || !['userflex-browser-session-v1', 'userflex-browser-session-v2'].includes(material.format)) {
    throw new Error('El material de sesión del perfil no es compatible con el motor KAIZEN.');
  }

  const target = new URL(profileUrl);
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const cookies = flattenCookies(material);
    const cookieResult = await applyCookies(browser, cookies);

    let pages = await browser.pages();
    let page = pages.find((item) => item.url() === 'about:blank') || pages[0];
    if (!page) page = await browser.newPage();

    const state = storagePayload(material);
    const stateOrigin = state.origin || target.origin;
    if (stateOrigin === target.origin) await installStorageScript(page, target.origin, state);

    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });

    let indexedDb = { restored: 0, total: 0 };
    if (state.indexedDB.length) {
      try {
        indexedDb = await page.evaluate(async () => {
          const pending = globalThis.__userflexSessionRestore;
          return pending && typeof pending.then === 'function'
            ? await Promise.race([
              pending,
              new Promise((resolve) => setTimeout(() => resolve({ restored: 0, total: -1 }), 15_000)),
            ])
            : { restored: 0, total: 0 };
        });
        if (indexedDb?.restored > 0) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
        }
      } catch {}
    }

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
