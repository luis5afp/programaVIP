const BLOCKED_INTERNAL = [
  'chrome://extensions',
  'chrome://settings',
  'edge://extensions',
  'edge://settings',
];

function isBlocked(url) {
  const value = String(url || '').toLowerCase();
  return BLOCKED_INTERNAL.some((prefix) => value.startsWith(prefix));
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !isBlocked(details.url)) return;
  chrome.tabs.update(details.tabId, { url: 'about:blank' }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (!isBlocked(tab?.url)) return;
  chrome.tabs.update(tabId, { url: 'about:blank' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('userflex-guard', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(() => void chrome.runtime.getPlatformInfo());
