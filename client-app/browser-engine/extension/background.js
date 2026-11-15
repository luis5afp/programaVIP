try { importScripts('strategy.js'); } catch {}

const STRATEGY = String(globalThis.USERFLEX_RUNTIME_STRATEGY || 'guard-only');
const BASE_BLOCKED = [
  'chrome://extensions',
  'chrome://settings',
  'edge://extensions',
  'edge://settings',
];
const HARDENED_BLOCKED = [
  'chrome://flags',
  'chrome://inspect',
  'chrome://policy',
  'chrome://password-manager',
  'edge://flags',
  'edge://inspect',
  'edge://policy',
  'edge://wallet',
  'https://chromewebstore.google.com/',
];
const BLOCKED_INTERNAL = STRATEGY === 'guard-only'
  ? BASE_BLOCKED
  : [...BASE_BLOCKED, ...HARDENED_BLOCKED];

function isBlocked(url) {
  const value = String(url || '').toLowerCase();
  return BLOCKED_INTERNAL.some((prefix) => value.startsWith(prefix));
}

async function moveAway(tabId) {
  try {
    await chrome.tabs.update(tabId, { url: 'about:blank' });
  } catch {}
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !isBlocked(details.url)) return;
  void moveAway(details.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (!isBlocked(tab?.url)) return;
  void moveAway(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!isBlocked(tab?.url)) return;
  void moveAway(tab.id);
});

// App-window command-line flags only protect the first Edge window. A site
// or a managed extension can subsequently create a *normal* Edge window,
// exposing the extensions toolbar. In restricted profiles, convert those
// additional browser windows to Chromium "popup" windows, which keep the
// same profile, cookies and managed extensions but have no browser toolbar.
// This is a best-effort UI guard, not a replacement for Windows policies.
const RESTRICTED_WINDOWS = globalThis.USERFLEX_BROWSER_EXTENSIONS_ACCESS === 'restricted';
const TABBED_RESTRICTED = RESTRICTED_WINDOWS && globalThis.USERFLEX_RESTRICTED_TABBED_BROWSER === true;
const RESTRICTED_HOME = (() => {
  try {
    const url = new URL(String(globalThis.USERFLEX_PROFILE_HOME_URL || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
})();
const convertingWindows = new Set();
let restrictedWindowBootstrap = false;

function allowedWindowUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

async function convertNormalWindow(windowId) {
  if (!RESTRICTED_WINDOWS || !RESTRICTED_HOME || !Number.isInteger(windowId)
    || windowId < 0 || convertingWindows.has(windowId)) return;
  convertingWindows.add(windowId);
  try {
    // Edge may dispatch onCreated before the page has been assigned its URL.
    await new Promise((resolve) => setTimeout(resolve, 280));
    const info = await chrome.windows.get(windowId, { populate: true });
    if (info?.type !== 'normal') return;
    const urls = (Array.isArray(info?.tabs) ? info.tabs : [])
      .map((tab) => allowedWindowUrl(tab?.pendingUrl || tab?.url))
      .filter(Boolean)
      .slice(0, 8);
    if (!urls.length) urls.push(RESTRICTED_HOME);
    let created = 0;
    for (const url of urls) {
      try {
        const popup = await chrome.windows.create({
          url,
          type: 'popup',
          focused: created === 0,
        });
        if (popup?.id != null) created++;
      } catch (error) {
        console.warn('userFLEX could not keep secondary page inside a popup window:', String(error?.message || error));
      }
    }
    // Do not destroy the original browser window unless the user still has
    // a visible replacement with the same authorized profile context.
    if (created > 0) {
      await chrome.windows.remove(windowId).catch(() => null);
    }
  } catch {
    // Window might have been closed concurrently by the CDP-level guard.
  } finally {
    convertingWindows.delete(windowId);
  }
}

if (RESTRICTED_WINDOWS && RESTRICTED_HOME && !TABBED_RESTRICTED) {
  chrome.windows.onCreated.addListener((windowInfo) => {
    if (windowInfo?.type !== 'normal') return;
    void convertNormalWindow(Number(windowInfo.id));
  });
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (!Number.isInteger(windowId) || windowId < 0) return;
    void convertNormalWindow(windowId);
  });
  // Handles normal windows created by Toolspoint before the Browser Guard
  // service worker registered its event listener at browser startup.
  async function inspectWindowsAtStartup() {
    if (restrictedWindowBootstrap) return;
    restrictedWindowBootstrap = true;
    try {
      const windows = await chrome.windows.getAll({ populate: false });
      for (const info of (Array.isArray(windows) ? windows : [])) {
        if (info?.type === 'normal') void convertNormalWindow(Number(info.id));
      }
    } catch {}
    restrictedWindowBootstrap = false;
  }
  chrome.runtime.onStartup.addListener(() => {
    void inspectWindowsAtStartup();
  });
  void inspectWindowsAtStartup();
}

// Edge with a native tab strip: keep the first normal window and fold
// secondary windows back into it via tabs.move. Same Chrome tab, same cookies,
// same proxy, same extension state, and window.opener remains intact.
const MAX_RESTRICTED_PAGES = 12;
let primaryWindowId = null;
const foldingWindows = new Set();
let discoveringWindows = false;

async function foldNormalWindow(windowId) {
  if (!TABBED_RESTRICTED || !Number.isInteger(windowId)
    || windowId < 0 || foldingWindows.has(windowId)) return;
  foldingWindows.add(windowId);
  try {
    // New window may still be about:blank when Edge delivers onCreated.
    await new Promise((resolve) => setTimeout(resolve, 160));
    const windows = await chrome.windows.getAll({ populate: true });
    const normal = (Array.isArray(windows) ? windows : [])
      .filter((win) => win?.type === 'normal' && Number.isInteger(win.id))
      .sort((a, b) => a.id - b.id);
    if (!normal.length) return;
    if (!normal.some((win) => win.id === primaryWindowId)) {
      const withHome = normal.find((win) => (win.tabs || []).some((tab) =>
        allowedWindowUrl(tab.pendingUrl || tab.url) === RESTRICTED_HOME));
      primaryWindowId = (withHome || normal[0]).id;
    }
    if (windowId === primaryWindowId) return;
    const extra = normal.find((win) => win.id === windowId);
    if (!extra) return;
    for (const tab of extra.tabs || []) {
      if (!Number.isInteger(tab.id)) continue;
      // Never move privileged Edge UI or extension-management pages.
      const url = allowedWindowUrl(tab.pendingUrl || tab.url);
      if (!url) continue;
      try {
        const existingTabs = await chrome.tabs.query({ windowId: primaryWindowId });
        if ((Array.isArray(existingTabs) ? existingTabs : []).length >= MAX_RESTRICTED_PAGES) break;
        await chrome.tabs.move(tab.id, { windowId: primaryWindowId, index: -1 });
      } catch (error) {
        console.warn('userFLOW could not consolidate an additional tab:', String(error?.message || error));
      }
    }
    // Fail closed: do not leave a second window with management controls.
    await chrome.windows.remove(windowId).catch(() => null);
  } catch {
    // The source window may already be closed.
  } finally {
    foldingWindows.delete(windowId);
  }
}

async function discoverTabbedWindows() {
  if (!TABBED_RESTRICTED || discoveringWindows) return;
  discoveringWindows = true;
  try {
    const all = await chrome.windows.getAll({ populate: true });
    const normal = (Array.isArray(all) ? all : [])
      .filter((win) => win?.type === 'normal' && Number.isInteger(win.id))
      .sort((a, b) => a.id - b.id);
    if (!normal.length) return;
    const withHome = normal.find((win) => (win.tabs || []).some((tab) =>
      allowedWindowUrl(tab.pendingUrl || tab.url) === RESTRICTED_HOME));
    if (!normal.some((win) => win.id === primaryWindowId)) {
      primaryWindowId = (withHome || normal[0]).id;
    }
    for (const win of normal) {
      if (win.id !== primaryWindowId) void foldNormalWindow(win.id);
    }
  } catch { /* Edge is still bootstrapping. */ }
  finally { discoveringWindows = false; }
}

if (TABBED_RESTRICTED && RESTRICTED_HOME) {
  chrome.windows.onCreated.addListener((win) => {
    if (win?.type !== 'normal') return;
    void discoverTabbedWindows();
  });
  chrome.windows.onFocusChanged.addListener((id) => {
    if (!Number.isInteger(id) || id < 0) return;
    if (id !== primaryWindowId) void foldNormalWindow(id);
  });
  chrome.runtime.onStartup.addListener(() => void discoverTabbedWindows());
  void discoverTabbedWindows();
}

const EXPECTED_MANAGED_NAMES = new Set(
  (Array.isArray(globalThis.USERFLEX_EXPECTED_MANAGED_EXTENSIONS)
    ? globalThis.USERFLEX_EXPECTED_MANAGED_EXTENSIONS
    : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
);
const PROTECTED_NAMES = new Set(['userFLEX Browser Guard', ...EXPECTED_MANAGED_NAMES]);
const protectedIds = new Set();
let closingForTamper = false;

function isProtected(item) {
  const id = String(item?.id || '');
  const name = String(item?.name || '');
  return (id && protectedIds.has(id)) || PROTECTED_NAMES.has(name);
}

async function closeManagedProfile() {
  if (closingForTamper) return;
  closingForTamper = true;
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    await Promise.all(
      (Array.isArray(windows) ? windows : [])
        .map((windowInfo) => Number(windowInfo?.id))
        .filter(Number.isInteger)
        .map((windowId) => chrome.windows.remove(windowId).catch(() => null)),
    );
  } catch {}
}

async function repairProtectedExtensions({ closeOnRepair = false } = {}) {
  let repaired = false;
  try {
    const items = await chrome.management.getAll();
    for (const item of items) {
      if (!PROTECTED_NAMES.has(String(item?.name || '')) || !item?.id) continue;
      protectedIds.add(String(item.id));
      if (item.enabled !== false) continue;
      repaired = true;
      await chrome.management.setEnabled(item.id, true).catch(() => null);
    }
  } catch {}
  if (repaired && closeOnRepair) await closeManagedProfile();
}

chrome.management.onDisabled.addListener((item) => {
  if (!isProtected(item)) return;
  if (item?.id) protectedIds.add(String(item.id));
  void (async () => {
    if (item?.id) await chrome.management.setEnabled(item.id, true).catch(() => null);
    await closeManagedProfile();
  })();
});

chrome.management.onInstalled.addListener((item) => {
  if (PROTECTED_NAMES.has(String(item?.name || '')) && item?.id) protectedIds.add(String(item.id));
  void repairProtectedExtensions({ closeOnRepair: false });
});

chrome.management.onUninstalled.addListener((extensionId) => {
  const id = String(extensionId || '');
  if (!id || !protectedIds.has(id)) return;
  void closeManagedProfile();
});

// Do not close a visible profile because the guard's own permission/storage
// bookkeeping changed. These events do not identify tampering with a protected
// managed extension and can occur during normal browser/extension lifecycle.
// Direct disable/uninstall of protected extensions remains enforced above, and
// the periodic repair still re-enables anything unexpectedly disabled.

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('userflex-guard', { periodInMinutes: 1 });
  void repairProtectedExtensions({ closeOnRepair: false });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== 'userflex-guard') return;
  void chrome.runtime.getPlatformInfo();
  void repairProtectedExtensions({ closeOnRepair: true });
});

void repairProtectedExtensions({ closeOnRepair: false });
