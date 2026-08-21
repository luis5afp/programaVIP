import { ModuleItem, Profile, ApiResponse, CourseHubData } from '../types';
import { apiRequest } from './apiClient';

export const moduleService = {
  /**
   * Get all modules and their embedded profiles
   */
  async getAll(): Promise<ApiResponse<ModuleItem[]>> {
    const res = await apiRequest<{ modules: ModuleItem[] } | ModuleItem[]>('/modules', { method: 'GET' });
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : res.data.modules || [];
      return { success: true, data: list };
    }
    return { success: false, error: res.error || 'Error al obtener módulos' };
  },

  /**
   * Create new module
   */
  async create(moduleData: Partial<ModuleItem>): Promise<ApiResponse<ModuleItem>> {
    return apiRequest<ModuleItem>('/modules', {
      method: 'POST',
      body: JSON.stringify(moduleData),
    });
  },

  /**
   * Update module details
   */
  async update(id: string, moduleData: Partial<ModuleItem>): Promise<ApiResponse<ModuleItem>> {
    return apiRequest<ModuleItem>(`/modules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(moduleData),
    });
  },

  /**
   * Delete module
   */
  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>(`/modules/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Add profile into a module
   */
  async addProfile(moduleId: string, profileData: Partial<Profile>): Promise<ApiResponse<{ profile: Profile; module: ModuleItem }>> {
    return apiRequest<{ profile: Profile; module: ModuleItem }>(`/modules/${moduleId}/profiles`, {
      method: 'POST',
      body: JSON.stringify(profileData),
    });
  },

  /**
   * Update profile within a module
   */
  async updateProfile(
    moduleId: string,
    profileId: string,
    profileData: Partial<Profile>
  ): Promise<ApiResponse<{ profile: Profile; module: ModuleItem }>> {
    return apiRequest<{ profile: Profile; module: ModuleItem }>(`/modules/${moduleId}/profiles/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  },

  /**
   * Delete profile from module
   */
  async deleteProfile(moduleId: string, profileId: string): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>(`/modules/${moduleId}/profiles/${profileId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Verify single profile credential
   */
  async verifyProfile(moduleId: string, profileId: string): Promise<ApiResponse<{ credentialOk: boolean; lastCheck: string }>> {
    return apiRequest<{ credentialOk: boolean; lastCheck: string }>(`/modules/${moduleId}/profiles/${profileId}/verify`, {
      method: 'POST',
    });
  },

  /**
   * Verify all credentials across all modules
   */
  async verifyAll(): Promise<ApiResponse<{ timestamp: string; data: CourseHubData; summary: any }>> {
    return apiRequest<{ timestamp: string; data: CourseHubData; summary: any }>('/verify-access', {
      method: 'POST',
    });
  },
};
