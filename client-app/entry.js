import { app, session } from 'electron';

// Electron's default UA appends an `Electron/x.y.z` product token. Some normal
// websites treat that token differently from the Chromium engine actually
// rendering the page. Keep the exact Chromium version from this runtime, but
// present a standards-compatible Chromium UA for profile browsing.
function chromiumUserAgent() {
  const chromeVersion = String(process.versions.chrome || '').trim();
  if (!chromeVersion) return null;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

const compatibleUserAgent = chromiumUserAgent();
if (compatibleUserAgent) app.userAgentFallback = compatibleUserAgent;

// Profile partitions are intentionally persistent so the managed first-party
// session can be restored into an isolated browser workspace. When a protected
// profile is opened, however, external sites must not inherit cache, service
// workers, IndexedDB or other browsing state created under an older network
// identity. Clear the partition once, immediately before its fixed proxy is
// applied. main.js then restores the managed profile cookies/storage from the
// server-delivered session material.
await app.whenReady();
const sessionPrototype = Object.getPrototypeOf(session.defaultSession);
const nativeSetProxy = sessionPrototype?.setProxy;
if (typeof nativeSetProxy === 'function') {
  const resetBeforeProtectedProxy = new WeakSet();
  sessionPrototype.setProxy = async function userflexCleanProfileState(config = {}) {
    if (config?.mode === 'fixed_servers' && !resetBeforeProtectedProxy.has(this)) {
      resetBeforeProtectedProxy.add(this);
      await Promise.allSettled([
        this.clearCache(),
        this.clearStorageData(),
      ]);
    }
    return nativeSetProxy.call(this, config);
  };
}

await import('./startup.js');
