import { app, session } from 'electron';

// Network switches that affect Chromium must be registered before Electron is
// ready. main.js is intentionally loaded only after the updater/bootstrap flow,
// which is too late for process-level transport policy. Protected profiles use
// TCP proxies, so disable QUIC/HTTP3 (UDP) and non-proxied WebRTC paths to keep
// page traffic on the configured profile egress.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

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

// setProxy updates Chromium's proxy configuration, but an existing persistent
// profile partition can still have pooled sockets and DNS state from the
// previous route. Flush transport state after every proxy transition without
// clearing cookies/local storage or the managed first-party session.
//
// Register this as a non-blocking whenReady callback. startup.js still owns the
// application lifecycle; unlike v0.2.34 there is no top-level await here.
app.whenReady().then(() => {
  const prototype = Object.getPrototypeOf(session.defaultSession);
  const nativeSetProxy = prototype?.setProxy;
  if (typeof nativeSetProxy !== 'function' || nativeSetProxy.__userflowTransportReset === true) return;

  const setProxyWithTransportReset = async function userflowSetProxyWithTransportReset(config = {}) {
    const result = await nativeSetProxy.call(this, config);
    try { await this.closeAllConnections(); } catch {}
    try { await this.clearHostResolverCache(); } catch {}
    return result;
  };
  Object.defineProperty(setProxyWithTransportReset, '__userflowTransportReset', { value: true });
  prototype.setProxy = setProxyWithTransportReset;
}).catch(() => {});

// Do not block Electron's native startup lifecycle here. startup.js owns the
// single-instance lock, updater bootstrap and runtime proxy adapter. Import it
// immediately so those lifecycle handlers are registered before ready.
void import('./startup.js');