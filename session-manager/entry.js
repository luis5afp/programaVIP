import { app, BrowserWindow } from 'electron';

// Keep Session Manager and userFLOW on the same Chromium network/identity
// settings so managed-session cookies are captured and later replayed under
// the same browser characteristics.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

function chromiumUserAgent() {
  const chromeVersion = String(process.versions.chrome || '').trim();
  if (!chromeVersion) return null;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

const compatibleUserAgent = chromiumUserAgent();
if (compatibleUserAgent) app.userAgentFallback = compatibleUserAgent;

function genericNavigationFailure(error) {
  if (!error || typeof error !== 'object') return false;
  return error.code === 'ERR_FAILED' || Number(error.errno) === -2;
}

// Electron can reject BrowserWindow.loadURL() with ERR_FAILED (-2) even when
// Chromium has actually committed/finished the HTTPS navigation. Netflix and
// other redirect-heavy sites can hit this race. Keep the real did-fail-load
// signal authoritative and only ignore the generic promise rejection when a
// successful HTTPS main-frame navigation was observed.
const nativeLoadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function guardedLoadURL(url, options = {}) {
  const target = String(url || '');
  if (!target.startsWith('https://') || this.isDestroyed()) {
    return nativeLoadURL.call(this, url, options);
  }

  const contents = this.webContents;
  let committedHttps = false;
  let finishedLoad = false;
  let mainFrameFailure = null;

  const onNavigate = (_event, navigatedUrl) => {
    if (String(navigatedUrl || '').startsWith('https://')) committedHttps = true;
  };
  const onFinish = () => {
    finishedLoad = true;
  };
  const onFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    mainFrameFailure = { errorCode, errorDescription, validatedURL };
  };

  contents.on('did-navigate', onNavigate);
  contents.on('did-finish-load', onFinish);
  contents.on('did-fail-load', onFail);

  try {
    try {
      return await nativeLoadURL.call(this, url, {
        ...options,
        reloadIgnoringCache: options?.reloadIgnoringCache ?? true,
      });
    } catch (error) {
      if (!genericNavigationFailure(error) || mainFrameFailure) throw error;

      // Give Chromium a short grace period to deliver a successful navigation
      // event after Electron's generic promise rejection.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      if (!this.isDestroyed() && !mainFrameFailure && (committedHttps || finishedLoad)) {
        console.warn(`Session Manager: ignored spurious ERR_FAILED after successful HTTPS navigation to ${target}.`);
        return;
      }
      throw error;
    }
  } finally {
    if (!contents.isDestroyed()) {
      contents.removeListener('did-navigate', onNavigate);
      contents.removeListener('did-finish-load', onFinish);
      contents.removeListener('did-fail-load', onFail);
    }
  }
};

void import('./main.js');
