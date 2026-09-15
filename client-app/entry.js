import { app } from 'electron';

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

// Do not block Electron's native startup lifecycle here. startup.js owns the
// whenReady() flow, single-instance lock, updater bootstrap and runtime proxy
// adapter. Import it immediately so those lifecycle handlers are registered
// before Electron reaches the ready state.
void import('./startup.js');
