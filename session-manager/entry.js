import { app } from 'electron';

// Keep Session Manager and userFLOW on the same Chromium network/identity
// settings so managed-session cookies are captured and later replayed under
// the same browser characteristics.
//
// Some authenticated/datacenter proxies fail generic Chromium navigations
// (notably Netflix) when HTTP/2 or QUIC is negotiated through the tunnel even
// though a simple proxy preflight succeeds. Force TCP + HTTP/1.1 here so the
// managed browser uses the most broadly compatible proxy transport and never
// falls back to a direct connection.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-http2');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

function chromiumUserAgent() {
  const chromeVersion = String(process.versions.chrome || '').trim();
  if (!chromeVersion) return null;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

const compatibleUserAgent = chromiumUserAgent();
if (compatibleUserAgent) app.userAgentFallback = compatibleUserAgent;

void import('./main.js');
