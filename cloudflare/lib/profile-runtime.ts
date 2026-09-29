export const BROWSER_ENGINES = ['chrome-native', 'nstchrome'] as const;
export const AUTH_STRATEGIES = ['manual', 'cookie-snapshot', 'credential-autofill', 'hybrid'] as const;
export const STORAGE_STRATEGIES = ['local-persistent', 'cookies-only', 'portable-first-party', 'netflix-local-device'] as const;
export const NETWORK_STRATEGIES = ['auto', 'client-direct', 'profile-proxy', 'assigned-proxy'] as const;
export const EXTENSION_STRATEGIES = ['guard-only', 'main', 'google', 'custom'] as const;

export type BrowserEngine = typeof BROWSER_ENGINES[number];
export type AuthStrategy = typeof AUTH_STRATEGIES[number];
export type StorageStrategy = typeof STORAGE_STRATEGIES[number];
export type NetworkStrategy = typeof NETWORK_STRATEGIES[number];
export type ExtensionStrategy = typeof EXTENSION_STRATEGIES[number];

export type ProfileRuntime = {
  browserEngine: BrowserEngine;
  authStrategy: AuthStrategy;
  storageStrategy: StorageStrategy;
  networkStrategy: NetworkStrategy;
  extensionStrategy: ExtensionStrategy;
  deviceLocalAuth: boolean;
};

export type NetworkPolicy = {
  effectiveProxyId: string | null;
  source: 'direct' | 'client-direct' | 'profile' | 'profile-locked' | 'assignment' | 'assignment-locked';
  required: boolean;
  locked: boolean;
};

function isOpenAiProfile(profile: any) {
  try {
    const host = new URL(String(profile?.url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'chatgpt.com'
      || host.endsWith('.chatgpt.com')
      || host === 'openai.com'
      || host.endsWith('.openai.com');
  } catch {
    return false;
  }
}

function profileHost(profile: any) {
  try {
    return new URL(String(profile?.url || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isNetflixProfile(profile: any) {
  const host = profileHost(profile);
  return host === 'netflix.com' || host.endsWith('.netflix.com');
}

function isGoogleFlowProfile(profile: any) {
  return profileHost(profile) === 'flow.google.com';
}

const STREAMING_HOSTS = [
  'netflix.com',
  'disneyplus.com',
  'max.com',
  'hbomax.com',
  'primevideo.com',
  'hulu.com',
  'peacocktv.com',
  'paramountplus.com',
  'tv.apple.com',
  'crunchyroll.com',
  'tubitv.com',
  'pluto.tv',
  'vix.com',
  'discoveryplus.com',
];

function isStreamingProviderProfile(profile: any) {
  const host = profileHost(profile);
  return STREAMING_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isStreamingProfile(profile: any) {
  const category = String(profile?.platform || '').trim().toLowerCase();
  return category === 'streaming' || isStreamingProviderProfile(profile);
}

export function effectiveProfileCategory(profile: any): string | null {
  if (isStreamingProfile(profile)) return 'STREAMING';
  const category = String(profile?.platform || '').trim();
  return category || null;
}

export function runtimeForProfile(profile: any): ProfileRuntime {
  const hasStoredSnapshot = profile?.session_ready === true;
  const configuredAuth = profile?.auth_strategy
    || (profile?.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
  const googleFlow = isGoogleFlowProfile(profile);

  // Modern Google sessions may use device-bound credentials. A central cookie
  // snapshot can still be useful as a bootstrap, but it cannot be the only
  // authentication mechanism on another Windows device. Upgrade Flow snapshot
  // profiles to hybrid automatically so the local browser can establish and
  // keep its own device-bound Google session using the managed credentials.
  const resolvedAuth = googleFlow && configuredAuth === 'cookie-snapshot'
    ? 'hybrid'
    : hasStoredSnapshot && configuredAuth === 'manual'
      ? 'cookie-snapshot'
      : configuredAuth;
  const authStrategy = resolvedAuth as AuthStrategy;

  const requestedStorage = (googleFlow && authStrategy !== 'manual'
    ? 'local-persistent'
    : profile?.storage_strategy
      || (authStrategy === 'manual' || authStrategy === 'credential-autofill'
        ? 'local-persistent'
        : 'portable-first-party')) as StorageStrategy;
  const snapshotManaged = authStrategy === 'cookie-snapshot' || authStrategy === 'hybrid';
  const openAiSnapshot = isOpenAiProfile(profile) && snapshotManaged;
  const streamingProviderSnapshot = isStreamingProviderProfile(profile) && snapshotManaged;
  const projectStreamingSnapshot = !isStreamingProviderProfile(profile)
    && String(profile?.platform || '').trim().toLowerCase() === 'streaming'
    && snapshotManaged;
  const googleFlowManaged = googleFlow && authStrategy !== 'manual';
  const effectiveStorage = openAiSnapshot
    ? 'cookies-only'
    : googleFlowManaged
      ? 'local-persistent'
      : streamingProviderSnapshot && requestedStorage !== 'cookies-only'
        ? 'netflix-local-device'
        : projectStreamingSnapshot && requestedStorage === 'netflix-local-device'
          ? 'portable-first-party'
          : requestedStorage;
  return {
    browserEngine: (profile?.browser_engine || 'chrome-native') as BrowserEngine,
    authStrategy,
    storageStrategy: effectiveStorage,
    networkStrategy: (profile?.network_strategy || 'auto') as NetworkStrategy,
    extensionStrategy: (profile?.extension_strategy
      || (authStrategy === 'manual' ? 'guard-only' : 'custom')) as ExtensionStrategy,
    // Device-bound providers must keep the authenticated browser state on the
    // client machine. Administrator cookies remain a bootstrap/fallback only.
    deviceLocalAuth: streamingProviderSnapshot || googleFlowManaged,
  };
}

export function snapshotAuthentication(runtime: ProfileRuntime) {
  return runtime.authStrategy === 'cookie-snapshot' || runtime.authStrategy === 'hybrid';
}

export function credentialAuthentication(runtime: ProfileRuntime) {
  return runtime.authStrategy === 'credential-autofill' || runtime.authStrategy === 'hybrid';
}

export function selectNetworkPolicy(
  runtime: ProfileRuntime,
  defaultProxyId: string | null,
  assignmentProxyId: string | null,
): NetworkPolicy {
  if (runtime.networkStrategy === 'client-direct') {
    return { effectiveProxyId: null, source: 'client-direct', required: false, locked: false };
  }
  if (runtime.networkStrategy === 'profile-proxy') {
    return { effectiveProxyId: defaultProxyId, source: 'profile-locked', required: true, locked: true };
  }
  if (runtime.networkStrategy === 'assigned-proxy') {
    return { effectiveProxyId: assignmentProxyId, source: 'assignment-locked', required: true, locked: true };
  }

  if (runtime.authStrategy === 'manual') {
    const effectiveProxyId = assignmentProxyId || defaultProxyId || null;
    return {
      effectiveProxyId,
      source: assignmentProxyId ? 'assignment' : defaultProxyId ? 'profile' : 'direct',
      required: false,
      locked: false,
    };
  }

  return {
    effectiveProxyId: defaultProxyId || null,
    source: defaultProxyId ? 'profile-locked' : 'direct',
    required: false,
    locked: Boolean(defaultProxyId),
  };
}

export function proxyRuntimeUsable(proxy: any) {
  if (!proxy || proxy.enabled !== true) return false;
  const type = String(proxy.proxy_type || '').toLowerCase();
  const status = String(proxy.validation_status || 'pending').toLowerCase();
  return ['http', 'https', 'socks4', 'socks5'].includes(type) && status !== 'invalid';
}

export function sameOrigin(left: string | null | undefined, right: string | null | undefined) {
  try {
    return new URL(String(left || '')).origin === new URL(String(right || '')).origin;
  } catch {
    return false;
  }
}
