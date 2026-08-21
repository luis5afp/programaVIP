import { AuditLogEntry, SecurityStats, ApiResponse } from '../types';
import { apiRequest } from './apiClient';

export const securityService = {
  /**
   * Get overall security statistics
   */
  async getStats(): Promise<ApiResponse<SecurityStats>> {
    return apiRequest<SecurityStats>('/security/stats', { method: 'GET' });
  },

  /**
   * Get audit log entries with optional filtering
   */
  async getAuditLogs(params?: { category?: string; limit?: number }): Promise<ApiResponse<AuditLogEntry[]>> {
    const res = await apiRequest<{ logs: AuditLogEntry[] } | AuditLogEntry[]>('/security/audit-logs', {
      method: 'GET',
      params,
    });
    if (res.success && res.data) {
      const list = Array.isArray(res.data) ? res.data : (res.data as any).logs || [];
      return { success: true, data: list };
    }
    return { success: false, error: res.error || 'Error al obtener registros de auditoría' };
  },

  /**
   * Record a new audit log
   */
  async logAction(entry: Partial<AuditLogEntry>): Promise<ApiResponse<AuditLogEntry>> {
    return apiRequest<AuditLogEntry>('/security/audit-logs', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },

  /**
   * Revoke all sessions for an admin or client
   */
  async revokeSession(targetId: string, type: 'admin' | 'client'): Promise<ApiResponse<{ message: string }>> {
    return apiRequest<{ message: string }>('/security/revoke-session', {
      method: 'POST',
      body: JSON.stringify({ targetId, type }),
    });
  },
};
