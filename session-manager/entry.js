import { app } from 'electron';

// The Session Manager window is now only a controller. Profile browsing itself
// runs in a native external Chrome/Edge process, following the KAIZEN engine.
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

// Dynamic import runs after command-line policy is configured but before
// app.whenReady() resolves inside main.js.
void import('./main.js');
