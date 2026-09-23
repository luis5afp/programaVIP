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

export function runtimeForProfile(profile: any): ProfileRuntime {
  const authStrategy = (profile?.auth_strategy
    || (profile?.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual')) as AuthStrategy;
  const requestedStorage = (profile?.storage_strategy
    || (authStrategy === 'manual' || authStrategy === 'credential-autofill'
      ? 'local-persistent'
      : 'portable-first-party')) as StorageStrategy;
  const openAiSnapshot = isOpenAiProfile(profile)
    && (authStrategy === 'cookie-snapshot' || authStrategy === 'hybrid');
  return {
    browserEngine: (profile?.browser_engine || 'chrome-native') as BrowserEngine,
    authStrategy,
    storageStrategy: openAiSnapshot ? 'cookies-only' : requestedStorage,
    networkStrategy: (profile?.network_strategy || 'auto') as NetworkStrategy,
    extensionStrategy: (profile?.extension_strategy
      || (authStrategy === 'manual' ? 'guard-only' : 'custom')) as ExtensionStrategy,
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
