import { ApiResponse } from '../types';

const CUSTOM_API_URL_KEY = 'coursehub-custom-api-url';
const API_TOKEN_KEY = 'coursehub-api-token';

// Retrieve base API URL dynamically (defaults to relative `/api`)
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem(CUSTOM_API_URL_KEY);
    if (custom) return custom.replace(/\/$/, '');
  }
  return '/api';
}

export function setCustomApiUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url.trim()) {
      localStorage.setItem(CUSTOM_API_URL_KEY, url.trim().replace(/\/$/, ''));
    } else {
      localStorage.removeItem(CUSTOM_API_URL_KEY);
    }
  }
}

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(API_TOKEN_KEY) || 'admin_bearer_demo_token_v6';
  }
  return null;
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Universal robust HTTP client for frontend to server communication
 */
export async function apiRequest<T = any>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { timeoutMs = 12000, params, ...customConfig } = options;
  const baseUrl = getApiBaseUrl();

  let url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  if (params) {
    const query = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Version': '6.0.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((customConfig.headers as Record<string, string>) || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...customConfig,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data?.error ? data.error : `HTTP ${response.status}: ${response.statusText}`;
      return {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }

    if (typeof data === 'object' && data !== null && 'success' in data) {
      return data as ApiResponse<T>;
    }

    return {
      success: true,
      data: data as T,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    return {
      success: false,
      error: isAbort ? 'Tiempo de espera agotado al conectar con el servidor' : (err.message || 'Error de conexión de red'),
      timestamp: new Date().toISOString(),
    };
  }
}

export const apiClient = {
  get: <T = any>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),
  post: <T = any>(endpoint: string, body?: any, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(endpoint: string, body?: any, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};

