import { INITIAL_DATA } from '../src/data/seed';

type KVNamespace = {
  get: (key: string, type?: string) => Promise<any>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type D1Database = {
  prepare: (query: string) => any;
  exec: (query: string) => Promise<any>;
};

type ExecutionContext = {
  waitUntil: (promise: Promise<any>) => void;
  passThroughOnException: () => void;
};

export interface Env {
  COURSEHUB_KV?: KVNamespace;
  DB?: D1Database;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

// In-memory worker isolate store
let memoryStore = JSON.parse(JSON.stringify(INITIAL_DATA));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // If it's an API route or OPTIONS preflight
    if (path.startsWith('/api') || path === '/health') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Version',
        'Content-Type': 'application/json; charset=utf-8',
      };

      if (method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Helper to get data
      const getData = async () => {
        if (env?.COURSEHUB_KV) {
          const stored = await env.COURSEHUB_KV.get('coursehub_data', 'json');
          if (stored) return stored;
        }
        return memoryStore;
      };

      // Helper to save data
      const saveData = async (data: any) => {
        memoryStore = data;
        if (env?.COURSEHUB_KV) {
          await env.COURSEHUB_KV.put('coursehub_data', JSON.stringify(data));
        }
      };

      // Health Check
      if (path === '/health' || path === '/api/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'CourseHub Cloudflare Worker Standalone API',
          version: '6.0.0',
          timestamp: new Date().toISOString(),
          hasKv: !!env.COURSEHUB_KV,
          hasD1: !!env.DB,
        }), { headers: corsHeaders });
      }

      // KV Data persistence
      if (path === '/api/data') {
        if (method === 'GET') {
          const data = await getData();
          return new Response(JSON.stringify({ success: true, data, timestamp: new Date().toISOString() }), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          await saveData(body);
          return new Response(JSON.stringify({ success: true, message: 'Guardado y sincronizado en Cloudflare', data: body }), { headers: corsHeaders });
        }
      }

      // App Version & GitHub Auto-Update Check
      if (path === '/api/version' || path === '/api/app-update') {
        return new Response(JSON.stringify({
          success: true,
          currentVersion: '6.2.0',
          latestVersion: '6.2.0',
          githubRepo: 'luis5afp/coursehub-vip',
          channel: 'latest',
          publishedAt: new Date().toISOString(),
          mandatory: true,
          releaseNotes: 'Sincronización en tiempo real, actualización de URLs y optimización de motor Chromium',
          downloadUrl: 'https://github.com/luis5afp/coursehub-vip/releases/latest',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        }), { headers: corsHeaders });
      }

      // Windows .EXE Installer Download - Redirect to official GitHub release binary
      if (path === '/api/download/client-exe' || path === '/download/client-exe') {
        return Response.redirect('https://github.com/luis5afp/coursehub-vip/releases/download/v6.2.0/CourseHub-VIP-Setup-6.2.0.exe', 302);
      }

      // Reset
      if (path === '/api/reset' && method === 'POST') {
        const resetData = JSON.parse(JSON.stringify(INITIAL_DATA));
        await saveData(resetData);
        return new Response(JSON.stringify({ success: true, message: 'Datos restablecidos', data: resetData }), { headers: corsHeaders });
      }

      // Benchmark
      if (path === '/api/system/benchmark') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            runtime: 'Cloudflare Worker Standalone V8',
            timestamp: new Date().toISOString(),
          },
        }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Not found', path }), { status: 404, headers: corsHeaders });
    }

    // Serve Frontend Static Assets
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response('CourseHub UI Ready. Configure ASSETS binding.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
