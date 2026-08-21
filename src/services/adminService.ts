import { AdminUser, RolePermission, ApiResponse } from '../types';
import { apiRequest } from './apiClient';

export const adminService = {
  /**
   * Get all admin users
   */
  async getAdmins(): Promise<ApiResponse<AdminUser[]>> {
    const res = await apiRequest<{ admins: AdminUser[] } | AdminUser[]>('/admins', { method: 'GET' });
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : res.data.admins || [];
      return { success: true, data: list };
    }
    return { success: false, error: res.error || 'Error al obtener administradores' };
  },

  /**
   * Create admin user
   */
  async createAdmin(adminData: Partial<AdminUser>): Promise<ApiResponse<AdminUser>> {
    return apiRequest<AdminUser>('/admins', {
      method: 'POST',
      body: JSON.stringify(adminData),
    });
  },

  /**
   * Update admin user
   */
  async updateAdmin(id: string, adminData: Partial<AdminUser>): Promise<ApiResponse<AdminUser>> {
    return apiRequest<AdminUser>(`/admins/${id}`, {
      method: 'PUT',
      body: JSON.stringify(adminData),
    });
  },

  /**
   * Delete admin user
   */
  async deleteAdmin(id: string): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>(`/admins/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get all roles & permissions
   */
  async getRoles(): Promise<ApiResponse<RolePermission[]>> {
    const res = await apiRequest<{ roles: RolePermission[] } | RolePermission[]>('/roles', { method: 'GET' });
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : res.data.roles || [];
      return { success: true, data: list };
    }
    return { success: false, error: res.error || 'Error al obtener roles' };
  },

  /**
   * Create role
   */
  async createRole(roleData: Partial<RolePermission>): Promise<ApiResponse<RolePermission>> {
    return apiRequest<RolePermission>('/roles', {
      method: 'POST',
      body: JSON.stringify(roleData),
    });
  },

  /**
   * Update role
   */
  async updateRole(name: string, roleData: Partial<RolePermission>): Promise<ApiResponse<RolePermission>> {
    return apiRequest<RolePermission>(`/roles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(roleData),
    });
  },

  /**
   * Delete role
   */
  async deleteRole(name: string): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>(`/roles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },
};
