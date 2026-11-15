// Independent event-driven witness: if Browser Guard is disabled or removed,
// close this single Edge profile immediately. No server calls or polling.
const REQUIRED_NAME = 'userFLEX Browser Guard';
let requiredId = null;
let closing = false;
async function closeManagedProfile() {
  if (closing) return;
  closing = true;
  try {
    const windows = await chrome.windows.getAll({populate:false});
    await Promise.all((Array.isArray(windows) ? windows : [])
      .map((window) => window?.id)
      .filter(Number.isInteger)
      .map((id) => chrome.windows.remove(id).catch(() => null)));
  } catch {}
}
async function inspectRequired() {
  try {
    const items = await chrome.management.getAll();
    const guard = items.find((item) => item?.name === REQUIRED_NAME);
    if (guard?.id) requiredId = String(guard.id);
    // This also detects an extension that was missing before this worker
    // started, after Chrome's initial extension registration has completed.
    if (guard?.enabled === false) void closeManagedProfile();
    if (!guard && requiredId) void closeManagedProfile();
  } catch {}
}
chrome.management.onDisabled.addListener((item) => {
  if (item?.name === REQUIRED_NAME || (requiredId && String(item?.id) === requiredId)) {
    void closeManagedProfile();
  }
});
chrome.management.onUninstalled.addListener((id) => {
  if (requiredId && String(id) === requiredId) void closeManagedProfile();
});
chrome.management.onInstalled.addListener((item) => {
  if (item?.name === REQUIRED_NAME && item?.id) requiredId = String(item.id);
});
chrome.runtime.onStartup.addListener(() => void inspectRequired());
chrome.runtime.onInstalled.addListener(() => void inspectRequired());
void inspectRequired();
