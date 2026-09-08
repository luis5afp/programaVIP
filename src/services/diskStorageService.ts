// Service to guarantee consolidated hard drive persistence on the client's PC
// Uses Persistent Storage API + IndexedDB to store every profile's isolated session,
// cookies, offline content and notes directly on the physical hard disk.

export interface ProfileDiskRecord {
  partitionId: string;
  clientId?: string;
  moduleId: string;
  profileId: string;
  moduleName: string;
  profileName: string;
  sessionToken?: string;
  cookiesDecrypted?: string;
  clientHwidHash?: string;
  notes?: string;
  offlineReady?: boolean;
  savedAt: string;
  dataSizeBytes: number;
}

export interface DiskStorageStats {
  persistedOnDisk: boolean;
  usageBytes: number;
  usageMB: string;
  quotaBytes: number;
  quotaGB: string;
  profilesCount: number;
  driver: 'IndexedDB (Disco Duro)' | 'LocalStorage (Fallback)';
}

const DB_NAME = 'CourseHub_VIP_Client_Storage';
const DB_VERSION = 1;
const STORE_PROFILES = 'profile_partitions';

class DiskStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB no soportado'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_PROFILES)) {
          db.createObjectStore(STORE_PROFILES, { keyPath: 'partitionId' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  // Request Windows / OS hard drive persistence permission
  public async ensureDiskPersistence(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        return isPersisted;
      } catch (err) {
        console.warn('No se pudo invocar navigator.storage.persist:', err);
      }
    }
    return false;
  }

  // Get current physical disk usage for all profiles
  public async getStorageStats(): Promise<DiskStorageStats> {
    let persistedOnDisk = false;
    let usageBytes = 0;
    let quotaBytes = 0;

    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.persisted) {
        try {
          persistedOnDisk = await navigator.storage.persisted();
        } catch {
          persistedOnDisk = false;
        }
      }
      if (navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          usageBytes = estimate.usage || 0;
          quotaBytes = estimate.quota || 0;
        } catch {
          // ignore
        }
      }
    }

    const all = await this.getAllProfileDiskRecords();

    return {
      persistedOnDisk,
      usageBytes,
      usageMB: (usageBytes / (1024 * 1024)).toFixed(2),
      quotaBytes,
      quotaGB: (quotaBytes / (1024 * 1024 * 1024)).toFixed(1),
      profilesCount: all.length,
      driver: 'IndexedDB (Disco Duro)',
    };
  }

  // Save profile partition data into client's physical hard disk
  public async saveProfilePartition(record: Omit<ProfileDiskRecord, 'savedAt' | 'dataSizeBytes'>): Promise<boolean> {
    const rawContent = JSON.stringify(record);
    const sizeBytes = new Blob([rawContent]).size;

    const fullRecord: ProfileDiskRecord = {
      ...record,
      savedAt: new Date().toISOString(),
      dataSizeBytes: sizeBytes,
    };

    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PROFILES, 'readwrite');
        const store = tx.objectStore(STORE_PROFILES);
        const req = store.put(fullRecord);
        req.onsuccess = () => resolve(true);
        req.onerror = () => {
          this.fallbackSaveLocalStorage(fullRecord);
          resolve(true);
        };
      });
    } catch {
      this.fallbackSaveLocalStorage(fullRecord);
      return true;
    }
  }

  // Read profile partition data from client's hard disk
  public async getProfilePartition(partitionId: string): Promise<ProfileDiskRecord | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PROFILES, 'readonly');
        const store = tx.objectStore(STORE_PROFILES);
        const req = store.get(partitionId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(this.fallbackGetLocalStorage(partitionId));
      });
    } catch {
      return this.fallbackGetLocalStorage(partitionId);
    }
  }

  // List all stored profiles on this PC's hard drive
  public async getAllProfileDiskRecords(): Promise<ProfileDiskRecord[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PROFILES, 'readonly');
        const store = tx.objectStore(STORE_PROFILES);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(this.fallbackGetAllLocalStorage());
      });
    } catch {
      return this.fallbackGetAllLocalStorage();
    }
  }

  // Delete a specific profile's partition from hard drive
  public async removeProfilePartition(partitionId: string): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PROFILES, 'readwrite');
        const store = tx.objectStore(STORE_PROFILES);
        const req = store.delete(partitionId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch {
      try {
        localStorage.removeItem(`ch_disk_${partitionId}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  // Alias for removeProfilePartition
  public async deleteProfilePartition(partitionId: string): Promise<boolean> {
    return this.removeProfilePartition(partitionId);
  }

  // Fallback to localStorage if IndexedDB is blocked
  private fallbackSaveLocalStorage(record: ProfileDiskRecord) {
    try {
      localStorage.setItem(`ch_disk_${record.partitionId}`, JSON.stringify(record));
    } catch (e) {
      console.error('Error in fallback storage:', e);
    }
  }

  private fallbackGetLocalStorage(partitionId: string): ProfileDiskRecord | null {
    try {
      const saved = localStorage.getItem(`ch_disk_${partitionId}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  private fallbackGetAllLocalStorage(): ProfileDiskRecord[] {
    const list: ProfileDiskRecord[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ch_disk_')) {
          const item = localStorage.getItem(k);
          if (item) list.push(JSON.parse(item));
        }
      }
    } catch {
      // ignore
    }
    return list;
  }
}

export const diskStorageService = new DiskStorageService();
