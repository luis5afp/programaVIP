// Keep the updater/startup surface visible until a real destination window
// (authorized catalog, login, or offline retry) has been shown by Electron.
// The handoff is process-local; it never stores credentials or catalog data.
let onDestinationVisible = null;

export function registerStartupWindowHandoff(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Startup handoff requires a callback');
  }
  onDestinationVisible = callback;
}

export function completeStartupWindowHandoff() {
  if (!onDestinationVisible) return false;
  const complete = onDestinationVisible;
  onDestinationVisible = null;
  complete();
  return true;
}
