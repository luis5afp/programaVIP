const BLOCKED_INTERNAL = [
  'chrome://extensions',
  'chrome://settings',
  'chrome://flags',
  'chrome://inspect',
  'chrome://policy',
  'chrome://password-manager',
  'edge://extensions',
  'edge://settings',
  'edge://flags',
  'edge://inspect',
  'edge://policy',
  'edge://wallet',
  'https://chromewebstore.google.com/',
];

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
