import { Client, ApiResponse } from '../types';
import { apiRequest } from './apiClient';

export const clientService = {
  /**
   * Get all clients
   */
  async getAll(): Promise<ApiResponse<Client[]>> {
    const res = await apiRequest<{ clients: Client[] } | Client[]>('/clients', { method: 'GET' });
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : res.data.clients || [];
      return { success: true, data: list };
    }
    return { success: false, error: res.error || 'Error al obtener clientes' };
  },

  /**
   * Get single client by ID
   */
  async getById(id: string): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${id}`, { method: 'GET' });
  },

  /**
   * Create new client
   */
  async create(clientData: Partial<Client>): Promise<ApiResponse<Client>> {
    return apiRequest<Client>('/clients', {
      method: 'POST',
      body: JSON.stringify(clientData),
    });
  },

  /**
   * Update existing client
   */
  async update(id: string, clientData: Partial<Client>): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(clientData),
    });
  },

  /**
   * Delete client
   */
  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>(`/clients/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Toggle a module access on/off for a client
   */
  async toggleModule(clientId: string, moduleId: string, enabled: boolean): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${clientId}/toggle-module`, {
      method: 'POST',
      body: JSON.stringify({ moduleId, enabled }),
    });
  },

  /**
   * Toggle a profile access on/off for a client
   */
  async toggleProfile(clientId: string, profileId: string, enabled: boolean): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${clientId}/toggle-profile`, {
      method: 'POST',
      body: JSON.stringify({ profileId, enabled }),
    });
  },

  /**
   * Revoke client device
   */
  async revokeDevice(clientId: string, deviceId: string): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${clientId}/devices/${deviceId}/revoke`, {
      method: 'POST',
    });
  },

  /**
   * Append an audit history item to client log
   */
  async addHistory(clientId: string, action: string): Promise<ApiResponse<Client>> {
    return apiRequest<Client>(`/clients/${clientId}/history`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },
};
