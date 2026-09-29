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

if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => void closeManagedProfile());
}
if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => void closeManagedProfile());
}
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(() => void closeManagedProfile());
}

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
