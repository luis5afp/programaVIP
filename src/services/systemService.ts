import { CourseHubData, ServerHealthInfo, ApiResponse } from '../types';
import { apiRequest, getApiBaseUrl } from './apiClient';

export const systemService = {
  /**
   * Health check
   */
  async checkHealth(): Promise<ServerHealthInfo> {
    const start = performance.now();
    const res = await apiRequest<any>('/health', { method: 'GET', timeoutMs: 5000 });
    const latencyMs = Math.round(performance.now() - start);

    if (res.success && res.data) {
      return {
        status: 'online',
        service: res.data.service || 'Servidor CourseHub Cloud',
        version: res.data.version || '6.0.0',
        edgeRuntime: res.data.edgeRuntime || res.data.environment || 'Node.js / Cloudflare',
        latencyMs,
        timestamp: res.data.timestamp || new Date().toISOString(),
      };
    }

    return {
      status: 'offline',
      latencyMs,
      error: res.error || 'No se pudo conectar con el servidor',
    };
  },

  /**
   * Run quick network and processing latency benchmark
   */
  async runBenchmark(): Promise<ApiResponse<{ latencyMs: number; iterations: number; avgLatency: number; serverInfo: any }>> {
    return apiRequest<{ latencyMs: number; iterations: number; avgLatency: number; serverInfo: any }>('/system/benchmark', {
      method: 'GET',
    });
  },

  /**
   * Export full database as structured JSON
   */
  async exportJson(): Promise<ApiResponse<CourseHubData>> {
    return apiRequest<CourseHubData>('/data', { method: 'GET' });
  },

  /**
   * Import / Overwrite full database JSON
   */
  async importJson(data: CourseHubData): Promise<ApiResponse<CourseHubData>> {
    return apiRequest<CourseHubData>('/data', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Reset database back to default initial seed
   */
  async resetDatabase(): Promise<ApiResponse<CourseHubData>> {
    return apiRequest<CourseHubData>('/reset', {
      method: 'POST',
    });
  },

  /**
   * Get raw Cloudflare D1 SQL Schema and Seed text
   */
  async getD1SqlSchema(): Promise<string> {
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/system/schema-sql`);
      if (res.ok) {
        return await res.text();
      }
    } catch (_) {}
    return '-- Fallback SQL Schema\nCREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, name TEXT);';
  },
};
