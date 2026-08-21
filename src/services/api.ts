import { CourseHubData, ServerHealthInfo } from '../types';
import { INITIAL_DATA } from '../data/seed';
import { getApiBaseUrl, setCustomApiUrl } from './apiClient';
import { systemService } from './systemService';

export type { ServerHealthInfo };
export { getApiBaseUrl, setCustomApiUrl };

const STORAGE_KEY = 'coursehub-v6-demo';
const SYNC_CHANNEL_NAME = 'coursehub-realtime-sync-v6';

let syncChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  }
} catch {
  // BroadcastChannel fallback if not supported
}

// 1. Health check function
export async function checkServerHealth(): Promise<ServerHealthInfo> {
  return systemService.checkHealth();
}

// Helper to compute a quick fingerprint of the data
export function getDataFingerprint(data: CourseHubData | null): string {
  if (!data) return '';
  try {
    return JSON.stringify({
      m: (data.modules || []).map((m) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        enabled: m.enabled,
        p: (m.profiles || []).map((p) => ({ id: p.id, u: p.url, img: p.image, n: p.name, ok: p.credentialOk })),
      })),
      c: (data.clients || []).map((c) => ({
        id: c.id,
        status: c.status,
        mods: c.modules,
        pids: c.profileIds,
      })),
    });
  } catch {
    return String(Date.now());
  }
}

// 2. Fetch full data (with local storage cache fallback)
export async function fetchFullData(): Promise<CourseHubData> {
  const baseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/data?_t=${Date.now()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });

    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data.modules) && Array.isArray(json.data.clients)) {
        // Cache to localStorage for offline resilience
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
        } catch (_) {}
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API Service] Backend no disponible, cargando desde almacenamiento local:', err);
  }

  // Fallback to local storage or initial seed
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) {}

  return INITIAL_DATA;
}

// 3. Save full data to backend, local cache, and broadcast in real-time
export async function syncFullData(data: CourseHubData): Promise<boolean> {
  // Always update local cache first
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}

  // Broadcast to other open tabs / client sessions instantly
  try {
    if (syncChannel) {
      syncChannel.postMessage({ type: 'DATA_SYNC', data, timestamp: Date.now() });
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('coursehub:sync', { detail: data }));
    }
  } catch (_) {}

  const baseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API Service] Fallo al sincronizar en backend:', err);
    return false;
  }
}

// 4. Subscribe to Real-Time Instant Broadcasts across tabs and windows
export function subscribeToDataSync(onSync: (newData: CourseHubData) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleBroadcast = (event: MessageEvent) => {
    if (event.data && event.data.type === 'DATA_SYNC' && event.data.data) {
      onSync(event.data.data);
    }
  };

  const handleCustomEvent = (event: Event) => {
    const custom = event as CustomEvent<CourseHubData>;
    if (custom.detail) {
      onSync(custom.detail);
    }
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed && Array.isArray(parsed.modules)) {
          onSync(parsed);
        }
      } catch (_) {}
    }
  };

  if (syncChannel) {
    syncChannel.addEventListener('message', handleBroadcast);
  }
  window.addEventListener('coursehub:sync', handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    if (syncChannel) {
      syncChannel.removeEventListener('message', handleBroadcast);
    }
    window.removeEventListener('coursehub:sync', handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}

// 5. Continuous Live Polling Engine (every 2.5 seconds + on window focus)
export function startLiveAutoSync(
  getCurrentData: () => CourseHubData,
  onRemoteUpdate: (newData: CourseHubData) => void,
  intervalMs = 2500
): () => void {
  let isRunning = true;
  let isChecking = false;

  const checkRemote = async () => {
    if (!isRunning || isChecking) return;
    isChecking = true;
    try {
      const remoteData = await fetchFullData();
      const current = getCurrentData();
      
      const currentFp = getDataFingerprint(current);
      const remoteFp = getDataFingerprint(remoteData);

      if (currentFp !== remoteFp && remoteData && Array.isArray(remoteData.modules)) {
        onRemoteUpdate(remoteData);
      }
    } catch {
      // ignore transient network hiccups
    } finally {
      isChecking = false;
    }
  };

  const intervalId = setInterval(checkRemote, intervalMs);

  const handleFocus = () => {
    checkRemote();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      checkRemote();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
  }

  return () => {
    isRunning = false;
    clearInterval(intervalId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  };
}

// 6. Verify All Access via API
export async function verifyAllAccessApi(): Promise<{ success: boolean; data?: CourseHubData }> {
  const baseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/verify-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
        } catch (_) {}
        return { success: true, data: json.data };
      }
    }
  } catch (err) {
    console.warn('[API Service] Fallo verify-access vía API, simulando localmente:', err);
  }
  return { success: false };
}

// 7. Reset data via API
export async function resetDatabaseApi(): Promise<CourseHubData> {
  const baseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[API Service] Fallo reset en backend, restableciendo localmente:', err);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DATA));
  return INITIAL_DATA;
}
