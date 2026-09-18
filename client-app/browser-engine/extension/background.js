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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('userflex-guard', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(() => void chrome.runtime.getPlatformInfo());
