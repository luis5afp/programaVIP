import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { credentialAutofillAllowsUrl, credentialAutofillOrigins } from './credential-policy.js';

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

function cookiePayload(cookie, relaxed = false) {
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
  if (!relaxed && sameSite) payload.sameSite = sameSite;
  const expires = Number(cookie.expires ?? cookie.expirationDate);
  if (Number.isFinite(expires) && expires > 0) payload.expires = expires;
  return payload;
}

async function applyCookies(browser, cookies) {
  let installed = 0;
  const rejected = [];
  const relaxed = [];
  for (const cookie of cookies) {
    try {
      await browser.setCookie(cookiePayload(cookie, false));
      installed += 1;
      continue;
    } catch (firstError) {
      try {
        // Chrome revisions occasionally reject a captured SameSite spelling.
        // Retry the same domain/path/value without SameSite before declaring
        // the cookie unusable. We never relax domain or security boundaries.
        await browser.setCookie(cookiePayload(cookie, true));
        installed += 1;
        relaxed.push(String(cookie?.name || ''));
        continue;
      } catch (secondError) {
        rejected.push({
          name: String(cookie?.name || ''),
          reason: secondError instanceof Error
            ? secondError.message
            : firstError instanceof Error ? firstError.message : String(secondError || firstError || ''),
        });
      }
    }
  }
  return { installed, rejected, relaxed };
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

function cookieIdentity(cookie) {
  const name = String(cookie?.name || '').toLowerCase();
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  const path = String(cookie?.path || '/');
  return `${name}|${domain}|${path}`;
}

function cookieExpired(cookie) {
  const expires = Number(cookie?.expires ?? cookie?.expirationDate);
  return Number.isFinite(expires) && expires > 0 && expires * 1000 <= Date.now();
}

export async function ensureManagedSnapshotCookies({ debugPort, profileUrl, material }) {
  const target = new URL(profileUrl);
  const flowTarget = isGoogleFlowTarget(target);
  const expected = flattenCookies(material)
    .filter((cookie) =>
      cookieDomainMatchesHost(cookie, target.hostname)
      || (flowTarget && isGoogleAccountsDomain(cookie?.domain)))
    .filter((cookie) => !cookieExpired(cookie));

  if (!expected.length) {
    return {
      expected: 0,
      presentBefore: 0,
      installed: 0,
      rejected: 0,
      missingAfter: 0,
      preservedExisting: 0,
    };
  }

  const browser = await connectKaizenBrowser(debugPort);
  try {
    const pages = await browser.pages();
    const page = pages.find((item) => /^https?:/i.test(item.url())) || pages[0] || await browser.newPage();
    const client = await page.createCDPSession();

    const readCookies = async () => {
      try {
        const result = await client.send('Storage.getCookies');
        return Array.isArray(result?.cookies) ? result.cookies : [];
      } catch {
        return [];
      }
    };

    try {
      const before = await readCookies();
      const beforeKeys = new Set(before.map(cookieIdentity));
      const missing = expected.filter((cookie) => !beforeKeys.has(cookieIdentity(cookie)));
      const presentBefore = expected.length - missing.length;

      // Existing cookies win, even if their value differs from the administrator
      // snapshot. Providers commonly rotate authentication cookies after a valid
      // login. We only repair cookies that disappeared entirely.
      const applied = missing.length
        ? await applyCookies(browser, missing)
        : { installed: 0, rejected: [], relaxed: [] };

      const after = await readCookies();
      const afterKeys = new Set(after.map(cookieIdentity));
      const missingAfter = expected.filter((cookie) => !afterKeys.has(cookieIdentity(cookie))).length;

      return {
        expected: expected.length,
        presentBefore,
        installed: Number(applied.installed || 0),
        rejected: Array.isArray(applied.rejected) ? applied.rejected.length : 0,
        missingAfter,
        preservedExisting: presentBefore,
      };
    } finally {
      await client.detach().catch(() => null);
    }
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function clearTransferredNetflixAuthCookies({ debugPort, profileUrl }) {
  const target = new URL(profileUrl);
  if (!isNetflixTarget(target)) return { cleared: 0, names: [] };

  const browser = await connectKaizenBrowser(debugPort);
  try {
    const pages = await browser.pages();
    const page = pages.find((item) => /^https?:/i.test(item.url())) || pages[0] || await browser.newPage();
    const client = await page.createCDPSession();
    try {
      const result = await client.send('Storage.getCookies');
      const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
      const selected = cookies.filter((cookie) =>
        cookieDomainMatchesHost(cookie, target.hostname)
        && ['netflixid', 'securenetflixid'].includes(String(cookie?.name || '').toLowerCase())
      );
      let cleared = 0;
      for (const cookie of selected) {
        try {
          await client.send('Network.deleteCookies', {
            name: String(cookie.name),
            domain: String(cookie.domain || ''),
            path: String(cookie.path || '/'),
          });
          cleared += 1;
        } catch {}
      }
      return { cleared, names: selected.map((cookie) => String(cookie.name || '')) };
    } finally {
      await client.detach().catch(() => null);
    }
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

function isGoogleFlowTarget(target) {
  return String(target?.hostname || '').toLowerCase() === 'flow.google.com';
}

function isGoogleAccountsDomain(value) {
  const hostname = String(value || '').replace(/^\./, '').toLowerCase();
  return hostname === 'accounts.google.com' || /^accounts\.google\.[a-z.]+$/i.test(hostname);
}

function isGoogleAuthCookieName(name) {
  return /^(?:SID|HSID|SSID|APISID|SAPISID|__Secure-(?:1P|3P)?SID|__Secure-(?:1P|3P)?APISID)$/i
    .test(String(name || ''));
}

async function clearGoogleFlowCookies(browser, target) {
  if (!isGoogleFlowTarget(target)) return { cleared: 0, names: [] };
  const pages = await browser.pages();
  const page = pages.find((item) => /^https?:/i.test(item.url())) || pages[0] || await browser.newPage();
  const client = await page.createCDPSession();
  try {
    const result = await client.send('Storage.getCookies');
    const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
    const selected = cookies.filter((cookie) =>
      cookieDomainMatchesHost(cookie, target.hostname)
      || isGoogleAccountsDomain(cookie?.domain));
    let cleared = 0;
    for (const cookie of selected) {
      try {
        await client.send('Network.deleteCookies', {
          name: String(cookie.name || ''),
          domain: String(cookie.domain || ''),
          path: String(cookie.path || '/'),
        });
        cleared += 1;
      } catch {}
    }
    return {
      cleared,
      names: selected.map((cookie) => String(cookie?.name || '')).filter(Boolean),
    };
  } finally {
    await client.detach().catch(() => null);
  }
}

async function verifyFirstPartyAuthCookies(page, target, capturedCookies) {
  const netflixTarget = isNetflixTarget(target);
  const flowTarget = isGoogleFlowTarget(target);
  if (!netflixTarget && !flowTarget) return { provider: null, ok: true, missing: [], rotated: [] };

  const client = await page.createCDPSession();
  try {
    const readInstalled = async () => {
      const result = await client.send('Storage.getCookies');
      return Array.isArray(result?.cookies) ? result.cookies : [];
    };

    if (netflixTarget) {
      const expected = new Map(
        capturedCookies
          .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname))
          .filter((cookie) => ['netflixid', 'securenetflixid'].includes(String(cookie.name || '').toLowerCase()))
          .map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value ?? '')]),
      );

      let installedCookies = await readInstalled();
      let installed = new Map(
        installedCookies
          .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname))
          .map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value ?? '')]),
      );

      // Netflix can rotate NetflixId/SecureNetflixId immediately on the first
      // authenticated navigation. The new values are valid and must not be
      // treated as a failed restore merely because they differ from the
      // captured snapshot. Give Chrome/Netflix a short window to settle and
      // verify presence, while the caller later verifies the real page state.
      for (let attempt = 0; attempt < 3 && expected.size > 0; attempt += 1) {
        const missingNow = [...expected.keys()].filter((name) => !String(installed.get(name) || ''));
        if (!missingNow.length) break;
        await delay(700);
        installedCookies = await readInstalled();
        installed = new Map(
          installedCookies
            .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname))
            .map((cookie) => [String(cookie.name || '').toLowerCase(), String(cookie.value ?? '')]),
        );
      }

      const missing = [...expected.keys()].filter((name) => !String(installed.get(name) || ''));
      const rotated = [...expected.entries()]
        .filter(([name, expectedValue]) => {
          const current = String(installed.get(name) || '');
          return Boolean(current) && current !== expectedValue;
        })
        .map(([name]) => name);

      return {
        provider: 'netflix',
        ok: missing.length === 0,
        missing,
        rotated,
      };
    }

    const expectedNames = new Set(
      capturedCookies
        .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname) || isGoogleAccountsDomain(cookie?.domain))
        .filter((cookie) => isGoogleAuthCookieName(cookie?.name) && String(cookie?.value ?? ''))
        .map((cookie) => String(cookie.name || '').toLowerCase()),
    );
    const installedCookies = await readInstalled();
    const installedNames = new Set(
      installedCookies
        .filter((cookie) => cookieDomainMatchesHost(cookie, target.hostname) || isGoogleAccountsDomain(cookie?.domain))
        .filter((cookie) => isGoogleAuthCookieName(cookie?.name) && String(cookie?.value ?? ''))
        .map((cookie) => String(cookie.name || '').toLowerCase()),
    );
    const overlap = expectedNames.size === 0 || [...expectedNames].some((name) => installedNames.has(name));
    return {
      provider: 'google-flow',
      ok: overlap,
      missing: overlap ? [] : [...expectedNames],
      rotated: [],
    };
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

export async function connectKaizenBrowser(debugPort, timeoutMs = 25_000) {
  const ready = await waitForDevtools(debugPort, timeoutMs);
  if (!ready) throw new Error('El navegador del perfil no abrió su puerto de control.');
  return puppeteer.connect({
    browserURL: `http://127.0.0.1:${debugPort}`,
    defaultViewport: null,
  });
}

export async function installCredentialAutofill({ debugPort, profileUrl, credentials, extensionStrategy = 'custom' }) {
  if (!credentials?.username || !credentials?.password) return { installed: false };
  const target = new URL(profileUrl);
  const allowedOrigins = credentialAutofillOrigins(profileUrl, extensionStrategy);
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const bootstrap = ({ allowedOrigins, username, password, performanceSensitive = false }) => {
      const currentHost = String(location.hostname || '').toLowerCase();
      if (location.protocol === 'https:'
        && currentHost !== 'accounts.google.com'
        && /^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(currentHost)
        && /^\/accounts\/SetSID(?:\/|$)/i.test(location.pathname)) {
        const canonical = new URL(location.href);
        canonical.hostname = 'accounts.google.com';
        location.replace(canonical.toString());
        return;
      }
      const googleAuthAllowed = Array.isArray(allowedOrigins)
        && allowedOrigins.includes('https://accounts.google.com')
        && location.protocol === 'https:'
        && (currentHost === 'accounts.google.com'
          || /^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(currentHost));
      if (!Array.isArray(allowedOrigins) || (!allowedOrigins.includes(location.origin) && !googleAuthAllowed)) return;

      const GLOBAL_KEY = '__userflexCredentialAutofillV4102';
      const existingAutomation = globalThis[GLOBAL_KEY];
      if (existingAutomation?.refresh) {
        try { existingAutomation.refresh(); } catch {}
        return;
      }

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

      const isInput = (element) =>
        Boolean(element && String(element.tagName || '').toLowerCase() === 'input');

      const fieldKind = (element) => {
        if (!isInput(element)) return null;
        if (element.dataset?.userflexCredentialProtected === '1') return 'password';
        const type = String(element.type || '').toLowerCase();
        const hint = [
          type,
          element.name,
          element.id,
          element.autocomplete,
          element.placeholder,
          element.getAttribute?.('aria-label') || '',
          element.getAttribute?.('data-testid') || '',
          element.getAttribute?.('data-test') || '',
          element.getAttribute?.('data-cy') || '',
        ].join(' ').toLowerCase();
        if (type === 'password' || /password|passwd|passcode|contrase|senha|motdepasse/.test(hint)) return 'password';
        if (type === 'email' || /email|e-mail|user|usuario|login|account|identifier|identifierid|correo/.test(hint)) return 'username';
        return null;
      };

      const protectPasswordField = (element) => {
        if (!isInput(element)) return false;
        try {
          element.dataset.userflexCredentialProtected = '1';
          if (String(element.type || '').toLowerCase() !== 'password') {
            try { element.type = 'password'; } catch {}
          }
          element.style.setProperty('-webkit-text-security', 'disc', 'important');
          element.style.setProperty('text-security', 'disc', 'important');
          element.setAttribute('autocomplete', 'current-password');
          return true;
        } catch {
          return false;
        }
      };

      const blockManagedPasswordClipboard = (event) => {
        const target = event?.target;
        if (!isInput(target)) return;
        if (target.dataset.userflexCredentialProtected !== '1') return;
        event.preventDefault();
        event.stopPropagation();
      };

      addEventListener('copy', blockManagedPasswordClipboard, true);
      addEventListener('cut', blockManagedPasswordClipboard, true);

      const LOGIN_INPUT_SELECTOR = [
        'input[type="password"]',
        'input[type="email"]',
        'input[autocomplete*="username" i]',
        'input[autocomplete*="email" i]',
        'input[autocomplete*="password" i]',
        'input[name*="email" i]',
        'input[name*="user" i]',
        'input[name*="login" i]',
        'input[name*="pass" i]',
        'input[id*="email" i]',
        'input[id*="user" i]',
        'input[id*="login" i]',
        'input[id*="pass" i]',
      ].join(',');

      const collectSearchRoots = () => {
        const roots = [];
        const seen = new Set();
        const queue = [document];

        while (queue.length && roots.length < 48) {
          const root = queue.shift();
          if (!root || seen.has(root)) continue;
          seen.add(root);
          roots.push(root);

          let elements = [];
          try { elements = Array.from(root.querySelectorAll?.('*') || []).slice(0, 1200); } catch {}
          for (const element of elements) {
            try {
              if (element.shadowRoot && !seen.has(element.shadowRoot)) queue.push(element.shadowRoot);
            } catch {}
            if (String(element.tagName || '').toLowerCase() === 'iframe') {
              try {
                const childDocument = element.contentDocument;
                if (childDocument && !seen.has(childDocument)) queue.push(childDocument);
              } catch {}
            }
          }
        }
        return roots;
      };

      const loginInputs = () => {
        const found = [];
        const seen = new Set();
        for (const root of collectSearchRoots()) {
          let matches = [];
          try { matches = Array.from(root.querySelectorAll?.(LOGIN_INPUT_SELECTOR) || []); } catch {}
          for (const element of matches) {
            if (seen.has(element)) continue;
            seen.add(element);
            if (!visible(element) || element.disabled || element.readOnly) continue;
            found.push(element);
            if (found.length >= 80) return found;
          }
        }
        return found;
      };

      const candidates = () => {
        const inputs = loginInputs();
        return {
          usernameInput: inputs.find((element) => fieldKind(element) === 'username') || null,
          passwordInput: inputs.find((element) => fieldKind(element) === 'password') || null,
        };
      };

      const setNativeValue = (element, value) => {
        if (!element) return false;
        try {
          try { element.focus({ preventScroll: true }); } catch {
            try { element.focus(); } catch {}
          }
          const kind = fieldKind(element);
          if (kind === 'password') protectPasswordField(element);
          const realm = element.ownerDocument?.defaultView || globalThis;
          const proto = realm.HTMLInputElement?.prototype || HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) descriptor.set.call(element, value);
          else element.value = value;

          // React/Vue/Svelte and native forms observe slightly different event
          // sequences. Emit the native input/change sequence in the element's
          // own realm so same-origin iframes behave like top-level forms.
          try {
            const InputEventCtor = realm.InputEvent || InputEvent;
            element.dispatchEvent(new InputEventCtor('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: String(value),
            }));
          } catch {
            const EventCtor = realm.Event || Event;
            element.dispatchEvent(new EventCtor('input', { bubbles: true, composed: true }));
          }
          const EventCtor = realm.Event || Event;
          element.dispatchEvent(new EventCtor('change', { bubbles: true, composed: true }));
          element.dispatchEvent(new EventCtor('blur', { bubbles: true, composed: true }));
          try { element.blur(); } catch {}
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
              display:flex; align-items:center; gap:4px; padding:3px 5px;
              border:1px solid rgba(59,130,246,.55); border-radius:9px;
              background:rgba(15,23,42,.97); color:#fff;
              box-shadow:0 8px 24px rgba(0,0,0,.32);
              font:600 11px/1.15 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
              white-space:nowrap; user-select:none;
            }
            .uf-brand {
              color:#60a5fa; font-size:9px; font-weight:900; letter-spacing:.045em;
              padding:4px 3px; text-transform:uppercase;
            }
            button {
              all:unset; box-sizing:border-box; cursor:pointer; border-radius:6px;
              padding:4px 9px; background:#1e293b; color:#e2e8f0;
              font:700 10px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
              border:1px solid rgba(148,163,184,.13);
            }
            button:hover { background:#1d4ed8; color:white; }
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
        const pageRect = (element) => {
          const rect = element.getBoundingClientRect();
          let left = rect.left;
          let top = rect.top;
          let right = rect.right;
          let bottom = rect.bottom;
          let view = element.ownerDocument?.defaultView;
          for (let depth = 0; view && view !== globalThis && depth < 6; depth += 1) {
            try {
              const frame = view.frameElement;
              if (!frame) break;
              const frameRect = frame.getBoundingClientRect();
              left += frameRect.left;
              right += frameRect.left;
              top += frameRect.top;
              bottom += frameRect.top;
              view = frame.ownerDocument?.defaultView;
            } catch {
              break;
            }
          }
          return { left, top, right, bottom, width: rect.width, height: rect.height };
        };
        const rect = pageRect(anchor);
        const topAbove = rect.top - 34;
        const top = topAbove >= 6 ? topAbove : Math.min(window.innerHeight - 34, rect.bottom + 6);
        const left = Math.max(6, Math.min(rect.left, window.innerWidth - 250));
        host.style.left = `${Math.round(left)}px`;
        host.style.top = `${Math.round(top)}px`;
        host.style.display = 'block';
      };

      const fillAvailable = () => {
        const { usernameInput, passwordInput } = candidates();
        if (usernameInput && !usernameInput.value) setNativeValue(usernameInput, username);
        if (passwordInput) {
          protectPasswordField(passwordInput);
          if (!passwordInput.value) setNativeValue(passwordInput, password);
          protectPasswordField(passwordInput);
        }
        positionHelper();
      };

      const start = (forced = false) => {
        // Heavy authenticated editors should not keep a credential observer
        // alive on their application shell. If they later present a real login
        // field, focusing that field activates the helper on demand.
        if (performanceSensitive && !forced) {
          const routeLooksLikeLogin = /(?:^|\/)(login|signin|sign-in|auth|account\/login)(?:\/|$)/i
            .test(location.pathname + location.search);
          let hasLoginSurface = false;
          try { hasLoginSurface = loginInputs().length > 0; } catch {}
          if (!routeLooksLikeLogin && !hasLoginSurface) {
            const activateOnLoginFocus = (event) => {
              const target = event?.target;
              if (!isInput(target) || !fieldKind(target)) return;
              removeEventListener('focusin', activateOnLoginFocus, true);
              start(true);
            };
            addEventListener('focusin', activateOnLoginFocus, true);
            return;
          }
        }

        let scanTimer = null;
        let stopped = false;

        const scheduleFill = (delayMs = 120) => {
          if (stopped || scanTimer) return;
          scanTimer = setTimeout(() => {
            scanTimer = null;
            const run = () => {
              if (!stopped) fillAvailable();
            };
            if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 700 });
            else run();
          }, delayMs);
        };

        const addedLoginSurface = (node) => {
          if (!node || node.nodeType !== 1) return false;
          if (node.matches?.(LOGIN_INPUT_SELECTOR)) return true;
          try {
            if (node.querySelector?.(LOGIN_INPUT_SELECTOR)) return true;
            if (node.shadowRoot?.querySelector?.(LOGIN_INPUT_SELECTOR)) return true;
          } catch {}
          return String(node.tagName || '').toLowerCase() === 'iframe';
        };

        const observedRoots = new WeakSet();
        const observers = [];
        const observeCurrentRoots = () => {
          for (const root of collectSearchRoots()) {
            const observeTarget = root.nodeType === 9 ? root.documentElement : root;
            if (!observeTarget || observedRoots.has(observeTarget)) continue;
            observedRoots.add(observeTarget);
            try {
              const rootObserver = new MutationObserver((mutations) => {
                if (mutations.some((mutation) =>
                  Array.from(mutation.addedNodes || []).some((node) => addedLoginSurface(node)))) {
                  scheduleFill(60);
                }
              });
              rootObserver.observe(observeTarget, { childList: true, subtree: true });
              observers.push(rootObserver);
            } catch {}
          }
        };

        scheduleFill(0);
        observeCurrentRoots();

        // The old KAIZEN helper survived SPA/modal transitions. Keep a bounded
        // fallback scan while a login surface is active, but never submit forms
        // or interfere with CAPTCHA/human verification widgets.
        const retryTimer = setInterval(() => {
          observeCurrentRoots();
          scheduleFill(0);
        }, 2500);
        const stopBackgroundScanning = () => {
          if (stopped) return;
          stopped = true;
          try { clearInterval(retryTimer); } catch {}
          for (const observer of observers) {
            try { observer.disconnect(); } catch {}
          }
          if (scanTimer) clearTimeout(scanTimer);
          scanTimer = null;
        };
        setTimeout(stopBackgroundScanning, 120000);
        addEventListener('pagehide', stopBackgroundScanning, { once: true });

        addEventListener('focusin', (event) => {
          const target = event?.target;
          if (isInput(target)) {
            scheduleFill(0);
            requestAnimationFrame(positionHelper);
          }
        }, true);
        addEventListener('scroll', () => {
          if (helperHost?.isConnected) requestAnimationFrame(positionHelper);
        }, true);
        addEventListener('resize', () => {
          if (helperHost?.isConnected) requestAnimationFrame(positionHelper);
        }, true);
        addEventListener('pageshow', () => {
          scheduleFill(0);
          if (helperHost?.isConnected) requestAnimationFrame(positionHelper);
        });

        for (const delayMs of [150, 600, 1600, 4000, 10000]) {
          setTimeout(() => scheduleFill(0), delayMs);
        }
      };

      globalThis[GLOBAL_KEY] = {
        refresh() {
          try { fillAvailable(); } catch {}
        },
      };

      if (document.documentElement) start();
      else addEventListener('DOMContentLoaded', start, { once: true });
    };
    const payload = {
      allowedOrigins,
      username: String(credentials.username),
      password: String(credentials.password),
      performanceSensitive: ['digen.ai'].some((domain) => {
        const host = String(target.hostname || '').toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      }),
    };
    const prepared = new WeakSet();
    let immediatePages = 0;

    const instrument = async (page) => {
      if (!page) return;
      try {
        if (!prepared.has(page)) {
          prepared.add(page);
          await page.evaluateOnNewDocument(bootstrap, payload);
        }
        if (credentialAutofillAllowsUrl(page.url(), payload.allowedOrigins)) {
          await page.evaluate(bootstrap, payload);
          immediatePages += 1;
        }
      } catch {}
    };

    const onTarget = async (targetHandle) => {
      try {
        if (targetHandle.type() !== 'page') return;
        await instrument(await targetHandle.page());
      } catch {}
    };

    browser.on('targetcreated', onTarget);
    browser.on('targetchanged', onTarget);

    const existingPages = await browser.pages();
    const pages = existingPages.length ? existingPages : [await browser.newPage()];
    await Promise.all(pages.map(instrument));

    // Google authentication can replace or create a page target between the
    // identifier and password challenges. Keep this CDP connection alive only
    // for the bounded login window so those targets receive the same trusted-
    // origin helper. The timer is unref'd and the browser process owns the
    // actual profile lifetime.
    let monitorClosed = false;
    const closeMonitor = async () => {
      if (monitorClosed) return;
      monitorClosed = true;
      try { browser.off('targetcreated', onTarget); } catch {}
      try { browser.off('targetchanged', onTarget); } catch {}
      await browser.disconnect().catch(() => null);
    };
    const monitorTimer = setTimeout(() => void closeMonitor(), 120000);
    monitorTimer.unref?.();
    browser.once('disconnected', () => {
      try { clearTimeout(monitorTimer); } catch {}
    });

    return {
      installed: true,
      origin: target.origin,
      allowedOrigins,
      visibleHelper: true,
      passwordProtection: 'masked-no-reveal-no-copy',
      pagesPrepared: pages.length,
      immediatePages,
      targetMonitoring: true,
    };
  } catch (error) {
    await browser.disconnect().catch(() => null);
    throw error;
  }
}

export async function inspectRuntimeProfile({ debugPort, profileUrl, extensionStrategy = 'custom', streamingProfile = false }) {
  const allowedOrigins = credentialAutofillOrigins(profileUrl, extensionStrategy);
  const profileTarget = new URL(profileUrl);
  const targetHostname = String(profileTarget.hostname || '').toLowerCase();
  const browser = await connectKaizenBrowser(debugPort);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const pages = await browser.pages();
    const page = pages.find((item) => credentialAutofillAllowsUrl(item.url(), allowedOrigins))
      || pages.find((item) => /^https?:/i.test(item.url()))
      || pages[0];
    if (!page) {
      return {
        currentUrl: null,
        loginLikeUrl: false,
        usernameFieldVisible: false,
        passwordFieldVisible: false,
        usernameFilled: false,
        passwordFilled: false,
        loginActionVisible: false,
        helperVisible: false,
        humanVerificationVisible: false,
        humanVerificationProvider: null,
      };
    }
    return await page.evaluate(({ targetHostname, streamingProfile }) => {
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
      const loginActionVisible = Array.from(document.querySelectorAll('a,button,[role="button"]'))
        .filter((element) => visible(element))
        .some((element) => {
          const label = String(
            element.textContent
            || element.getAttribute('aria-label')
            || element.getAttribute('title')
            || '',
          ).replace(/\s+/g, ' ').trim().toLowerCase();
          return /(?:^|\b)(log in|login|sign in|signin|iniciar sesi[oó]n|acceder|entrar)(?:\b|$)/.test(label);
        });
      const href = location.href;
      const currentHost = String(location.hostname || '').toLowerCase();
      const streamingTestHarness = streamingProfile
        ? {
            enabled: document.documentElement?.dataset.userflexStreamingDom === 'active',
            overlays: Number(document.documentElement?.dataset.userflexStreamingMatched || 0),
            hidden: Number(document.documentElement?.dataset.userflexStreamingHidden || 0),
          }
        : { enabled: false, overlays: 0, hidden: 0 };

      const googleAccounts = currentHost === 'accounts.google.com' || /^accounts\.google\.[a-z.]+$/i.test(currentHost);
      const pageText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const challengeFrameSources = Array.from(document.querySelectorAll('iframe'))
        .map((frame) => String(frame.getAttribute('src') || '').toLowerCase())
        .filter(Boolean);
      const hasTurnstile = challengeFrameSources.some((src) => src.includes('challenges.cloudflare.com'))
        || Boolean(document.querySelector('[data-sitekey][data-callback], .cf-turnstile'));
      const hasRecaptcha = challengeFrameSources.some((src) => src.includes('recaptcha'))
        || Boolean(document.querySelector('.g-recaptcha, [data-sitekey][data-action]'));
      const hasHcaptcha = challengeFrameSources.some((src) => src.includes('hcaptcha'))
        || Boolean(document.querySelector('.h-captcha'));
      const humanVerificationText = /verify (?:that )?you(?:'|’)re human|verify you are human|confirm you are human|human verification|verifica(?:r)? que eres humano|comprueba que eres humano|no soy un robot|i am not a robot|captcha/.test(pageText);
      const humanVerificationVisible = hasTurnstile || hasRecaptcha || hasHcaptcha || humanVerificationText;
      const humanVerificationProvider = hasTurnstile
        ? 'cloudflare-turnstile'
        : hasRecaptcha
          ? 'google-recaptcha'
          : hasHcaptcha
            ? 'hcaptcha'
            : humanVerificationText ? 'generic' : null;
      const flowPublicLanding = targetHostname === 'flow.google.com'
        && currentHost === 'flow.google.com'
        && (
          location.pathname.toLowerCase() === '/about'
          || pageText.includes('crear con google flow')
          || pageText.includes('create with google flow')
        );
      const flowSignedOut = targetHostname === 'flow.google.com'
        && (googleAccounts || loginActionVisible || flowPublicLanding);
      const netflixHouseholdRestriction = (targetHostname === 'netflix.com' || targetHostname.endsWith('.netflix.com'))
        && (
          pageText.includes('no forma parte del hogar con netflix')
          || pageText.includes('not part of the netflix household')
          || pageText.includes('ver temporalmente')
          || pageText.includes('watch temporarily')
        );
      const streamingAccessRestriction = Boolean(
        streamingProfile
        && (
          netflixHouseholdRestriction
          || /(?:no forma parte|not part of)[^.!?]{0,120}(?:hogar|household|cuenta|account)/i.test(pageText)
          || /(?:ver|watch)[^.!?]{0,50}(?:temporalmente|temporarily)/i.test(pageText)
          || /(?:demasiados|too many)[^.!?]{0,60}(?:dispositivos|devices)/i.test(pageText)
          || /(?:dispositivo|device)[^.!?]{0,90}(?:hogar|household|l[ií]mite|limit)/i.test(pageText)
        )
      );
      return {
        currentUrl: href,
        loginLikeUrl: flowSignedOut
          || /(?:\/|^)(login|signin|sign-in|auth|servicelogin)(?:\/|\?|#|$)/i.test(location.pathname + location.search),
        flowSignedOut,
        netflixHouseholdRestriction,
        streamingAccessRestriction,
        streamingTestHarness,
        usernameFieldVisible: Boolean(username),
        passwordFieldVisible: Boolean(password),
        usernameFilled: Boolean(username && String(username.value || '').length > 0),
        passwordFilled: Boolean(password && String(password.value || '').length > 0),
        loginActionVisible,
        helperVisible: Boolean(document.getElementById('__userflex-credential-helper')),
        humanVerificationVisible,
        humanVerificationProvider,
      };
    }, { targetHostname, streamingProfile: streamingProfile === true }).catch(() => ({
      currentUrl: page.url(),
      loginLikeUrl: /accounts\.google\.|(?:\/|^)(login|signin|sign-in|auth|servicelogin)(?:\/|\?|#|$)/i.test(page.url()),
      flowSignedOut: targetHostname === 'flow.google.com' && /accounts\.google\./i.test(page.url()),
      netflixHouseholdRestriction: false,
      streamingAccessRestriction: false,
      streamingTestHarness: { enabled: false, overlays: 0, hidden: 0 },
      usernameFieldVisible: false,
      passwordFieldVisible: false,
      usernameFilled: false,
      passwordFilled: false,
      loginActionVisible: false,
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
    // Google sessions are account-wide and can leave stale cookies in a
    // persistent profile. A new Flow snapshot must be authoritative: clear the
    // prior Google/Accounts cookie set before applying the captured generation.
    const googleCleanup = isGoogleFlowTarget(target)
      ? await clearGoogleFlowCookies(browser, target)
      : { cleared: 0, names: [] };
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
    const cookieVerification = await verifyFirstPartyAuthCookies(page, target, cookies);

    const finalPages = await browser.pages();
    for (const extra of finalPages) {
      if (extra === page) continue;
      try { await extra.close(); } catch {}
    }

    return {
      cookiesInstalled: cookieResult.installed,
      cookiesRejected: cookieResult.rejected.length,
      googleCookiesCleared: Number(googleCleanup?.cleared || 0),
      googleCookiesAuthoritative: isGoogleFlowTarget(target),
      indexedDbRestored: Number(indexedDb?.restored || 0),
      indexedDbTotal: Number(indexedDb?.total || 0),
      storagePolicy: effectiveStorageStrategy,
      pageUrl: page.url(),
      cookieVerification,
    };
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export async function navigateBrowserHome(debugPort, profileUrl, { closeExtraPages = false } = {}) {
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const pages = await browser.pages();
    const page = pages.find((item) => /^https?:/i.test(item.url())) || pages[0] || await browser.newPage();
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (closeExtraPages) {
      const finalPages = await browser.pages();
      for (const extra of finalPages) {
        if (extra === page) continue;
        try { await extra.close(); } catch {}
      }
    }
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
    const blockedPrefixes = [
      'devtools://',
      'chrome://extensions',
      'chrome://settings',
      'chrome://flags',
      'chrome://inspect',
      'chrome://policy',
      'edge://extensions',
      'edge://settings',
      'edge://flags',
      'edge://inspect',
      'edge://policy',
    ];
    for (const target of Array.isArray(targets) ? targets : []) {
      const url = String(target?.url || '').toLowerCase();
      if (!target?.id || !blockedPrefixes.some((prefix) => url.startsWith(prefix))) continue;
      await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(target.id)}`).catch(() => null);
    }
  } catch {}
}
