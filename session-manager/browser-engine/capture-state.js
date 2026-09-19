import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

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

  if (target.hostname === 'netflix.com' || target.hostname.endsWith('.netflix.com')) {
    const pathname = String(state.pathname || '').toLowerCase();
    if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
      throw new Error('Netflix todavía no tiene la cuenta abierta. Completa el inicio de sesión antes de guardar.');
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

export async function capturePortableSession({ debugPort, profile, networkMode = 'direct' }) {
  const target = new URL(profile.url);
  const browser = await connectCaptureBrowser(debugPort);
  try {
    const page = await pageForOrigin(browser, target);
    const pageState = await validateCapturePage(page, target);
    const cookiesRaw = await allCookies(page);
    const cookies = cookiesRaw
      .filter((cookie) => cookie?.name && domainMatches(cookie.domain, target.hostname))
      .map(normalizeCookie);

    if (target.hostname === 'netflix.com' || target.hostname.endsWith('.netflix.com')) {
      const names = new Set(cookies.map((cookie) => cookie.name.toLowerCase()));
      const missing = ['netflixid', 'securenetflixid'].filter((name) => !names.has(name));
      if (missing.length) {
        throw new Error('Netflix todavía no expuso las cookies de autenticación activas. Confirma que la cuenta esté abierta y vuelve a guardar.');
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

export async function navigateCaptureHome(debugPort, profileUrl) {
  const browser = await connectCaptureBrowser(debugPort);
  try {
    const target = new URL(profileUrl);
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
