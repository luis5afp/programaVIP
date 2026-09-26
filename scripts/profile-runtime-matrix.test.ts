import assert from 'node:assert/strict';
import {
  credentialAuthentication,
  effectiveProfileCategory,
  proxyRuntimeUsable,
  runtimeForProfile,
  sameOrigin,
  selectNetworkPolicy,
  snapshotAuthentication,
} from '../cloudflare/lib/profile-runtime.ts';

const manual = runtimeForProfile({
  session_mode: 'manual-login',
  auth_strategy: 'manual',
  network_strategy: 'auto',
});
assert.equal(manual.authStrategy, 'manual');
assert.equal(manual.storageStrategy, 'local-persistent');
assert.equal(snapshotAuthentication(manual), false);
assert.equal(credentialAuthentication(manual), false);

const snapshot = runtimeForProfile({
  session_mode: 'managed-first-party',
  auth_strategy: 'cookie-snapshot',
  network_strategy: 'auto',
});
assert.equal(snapshotAuthentication(snapshot), true);
assert.equal(credentialAuthentication(snapshot), false);

const netflixSnapshot = runtimeForProfile({
  url: 'https://www.netflix.com/browse',
  session_mode: 'managed-first-party',
  auth_strategy: 'cookie-snapshot',
  storage_strategy: 'portable-first-party',
  network_strategy: 'auto',
});
assert.equal(
  netflixSnapshot.storageStrategy,
  'netflix-local-device',
  'existing and future Netflix snapshots must always use device-local web storage while reusing managed auth cookies',
);

const netflixCookiesOnly = runtimeForProfile({
  url: 'https://www.netflix.com/browse',
  session_mode: 'managed-first-party',
  auth_strategy: 'cookie-snapshot',
  storage_strategy: 'cookies-only',
  network_strategy: 'auto',
});
assert.equal(netflixCookiesOnly.storageStrategy, 'cookies-only');

assert.equal(effectiveProfileCategory({
  url: 'https://www.netflix.com/browse',
  platform: 'PELICULA',
}), 'STREAMING');

const streamingCategorySnapshot = runtimeForProfile({
  url: 'https://example-streaming.invalid/',
  platform: 'STREAMING',
  session_mode: 'managed-first-party',
  auth_strategy: 'cookie-snapshot',
  storage_strategy: 'portable-first-party',
  network_strategy: 'auto',
});
assert.equal(
  streamingCategorySnapshot.storageStrategy,
  'netflix-local-device',
  'STREAMING category must keep browser/device storage local while replaying the managed session',
);
assert.equal(effectiveProfileCategory({ url: 'https://example-streaming.invalid/', platform: 'streaming' }), 'STREAMING');

const disneySnapshot = runtimeForProfile({
  url: 'https://www.disneyplus.com/',
  platform: 'Video',
  session_mode: 'managed-first-party',
  auth_strategy: 'hybrid',
  storage_strategy: 'portable-first-party',
});
assert.equal(disneySnapshot.storageStrategy, 'netflix-local-device');
assert.equal(effectiveProfileCategory({ url: 'https://www.disneyplus.com/', platform: 'Video' }), 'STREAMING');

const autofill = runtimeForProfile({
  session_mode: 'managed-first-party',
  auth_strategy: 'credential-autofill',
  network_strategy: 'assigned-proxy',
});
assert.equal(snapshotAuthentication(autofill), false);
assert.equal(credentialAuthentication(autofill), true);

const hybrid = runtimeForProfile({
  session_mode: 'managed-first-party',
  auth_strategy: 'hybrid',
  network_strategy: 'profile-proxy',
});
assert.equal(snapshotAuthentication(hybrid), true);
assert.equal(credentialAuthentication(hybrid), true);

assert.deepEqual(
  selectNetworkPolicy(manual, 'profile', 'assignment'),
  { effectiveProxyId: 'assignment', source: 'assignment', required: false, locked: false },
);
assert.deepEqual(
  selectNetworkPolicy(snapshot, 'profile', 'assignment'),
  { effectiveProxyId: 'profile', source: 'profile-locked', required: false, locked: true },
);
assert.deepEqual(
  selectNetworkPolicy({ ...snapshot, networkStrategy: 'client-direct' }, 'profile', 'assignment'),
  { effectiveProxyId: null, source: 'client-direct', required: false, locked: false },
);
assert.deepEqual(
  selectNetworkPolicy({ ...snapshot, networkStrategy: 'profile-proxy' }, 'profile', 'assignment'),
  { effectiveProxyId: 'profile', source: 'profile-locked', required: true, locked: true },
);
assert.deepEqual(
  selectNetworkPolicy({ ...snapshot, networkStrategy: 'assigned-proxy' }, 'profile', 'assignment'),
  { effectiveProxyId: 'assignment', source: 'assignment-locked', required: true, locked: true },
);
assert.deepEqual(
  selectNetworkPolicy({ ...snapshot, networkStrategy: 'assigned-proxy' }, 'profile', null),
  { effectiveProxyId: null, source: 'assignment-locked', required: true, locked: true },
);

assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'socks5', validation_status: 'valid' }), true);
assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'http', validation_status: 'reachable' }), true);
assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'socks4', validation_status: 'unverifiable' }), true);
assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'unknown', validation_status: 'unverifiable' }), false);
assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'ssh', validation_status: 'valid' }), false);
assert.equal(proxyRuntimeUsable({ enabled: true, proxy_type: 'socks5', validation_status: 'invalid' }), false);
assert.equal(proxyRuntimeUsable({ enabled: false, proxy_type: 'socks5', validation_status: 'valid' }), false);

assert.equal(sameOrigin('https://www.netflix.com/pe/', 'https://www.netflix.com/login'), true);
assert.equal(sameOrigin('https://www.netflix.com/', 'https://netflix.com/'), false);
assert.equal(sameOrigin('https://chatgpt.com/', 'https://flow.google.com/'), false);

console.log('Profile runtime matrix: OK');
