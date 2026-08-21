import { apiClient } from './apiClient';
import { ValidationCode, ModuleItem, ApiResponse } from '../types';

export interface ClientAppAuthResponse {
  client: {
    id: string;
    name: string;
    email: string;
    plan: string;
    status: string;
  };
  modules: Array<{
    id: string;
    name: string;
    icon: string;
    desc: string;
    category?: 'courses' | 'ai' | 'web';
    profiles: Array<{
      id: string;
      name: string;
      url: string;
      username: string;
      image?: string;
      credentialOk: boolean;
      partitionId: string;
    }>;
  }>;
  serverTime: string;
}

export interface ValidationResult {
  sessionToken: string;
  partitionId: string;
  validatedAt: string;
  isolatedCookiesKey: string;
  module?: { id: string; name: string };
  profile?: { id: string; name: string; url: string; username: string };
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  githubRepo: string;
  channel: string;
  publishedAt: string;
  mandatory: boolean;
  releaseNotes: string;
  downloadUrl: string;
  sha256: string;
}

export const desktopAppService = {
  // Check for GitHub / Server updates at PC startup
  async checkForAppUpdate(localVersion = '6.1.0'): Promise<ApiResponse<AppUpdateInfo>> {
    try {
      const res = await apiClient.get<any>('/app-update');
      if (res.success && res.data) {
        const latest = res.data.latestVersion || '6.2.0';
        const hasUpdate = latest !== localVersion;
        return {
          success: true,
          data: {
            ...res.data,
            currentVersion: localVersion,
            hasUpdate,
          },
        };
      }
      return {
        success: true,
        data: {
          currentVersion: localVersion,
          latestVersion: '6.2.0',
          hasUpdate: true,
          githubRepo: 'luis5afp/coursehub-vip',
          channel: 'latest',
          publishedAt: new Date().toISOString(),
          mandatory: true,
          releaseNotes: 'Sincronización en tiempo real y actualización de URLs',
          downloadUrl: 'https://github.com/luis5afp/coursehub-vip/releases/latest',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      };
    } catch {
      return {
        success: false,
        error: 'No se pudo contactar el servidor de actualizaciones.',
      };
    }
  },

  // Client login from PC Installer
  async clientAuth(params: {
    identifier: string;
    password?: string;
    hwid?: string;
    deviceName?: string;
    os?: string;
  }): Promise<ApiResponse<ClientAppAuthResponse>> {
    return apiClient.post<ClientAppAuthResponse>('/client-app/auth', params);
  },

  // Get accessible modules for a client
  async getAccessibleModules(clientId: string): Promise<ApiResponse<ModuleItem[]>> {
    return apiClient.get<ModuleItem[]>(`/client-app/modules/${clientId}`);
  },

  // Generate 6-digit code (Admin feature)
  async generateValidationCode(params: {
    clientId: string;
    moduleId: string;
    profileId: string;
    expiresInHours?: number;
  }): Promise<ApiResponse<ValidationCode>> {
    return apiClient.post<ValidationCode>('/client-app/generate-code', params);
  },

  // Validate 6-digit code for launching a course session in isolated partition
  async validateCourseCode(params: {
    code: string;
    clientId: string;
    moduleId: string;
    profileId?: string;
    hwid?: string;
  }): Promise<ApiResponse<ValidationResult>> {
    return apiClient.post<ValidationResult>('/client-app/validate-code', params);
  },

  // List all validation codes
  async getValidationCodes(): Promise<ApiResponse<ValidationCode[]>> {
    return apiClient.get<ValidationCode[]>('/client-app/codes');
  },

  // Revoke a validation code
  async revokeValidationCode(code: string): Promise<ApiResponse<{ message: string }>> {
    return apiClient.delete<{ message: string }>(`/client-app/codes/${code}`);
  },

  // Heartbeat session sync
  async syncSession(params: {
    clientId: string;
    moduleId?: string;
    profileId?: string;
    hwid?: string;
  }): Promise<ApiResponse<{ timestamp: string }>> {
    return apiClient.post<{ timestamp: string }>('/client-app/sync-session', params);
  },
};
