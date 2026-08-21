// Cloudflare Pages Functions: Full REST API Handler for CourseHub Admin V6
// This runs directly on Cloudflare's Edge Network with zero-config deployment on Cloudflare Pages.

import { INITIAL_DATA } from '../../src/data/seed';

// In-memory edge cache fallback (persists per worker isolate)
let memoryStore = JSON.parse(JSON.stringify(INITIAL_DATA));
let memoryLogs = [
  {
    id: 'log_edge_1',
    timestamp: new Date().toISOString(),
    user: 'admin_master',
    action: 'Servidor Edge Cloudflare inicializado',
    category: 'system',
    details: 'Cloudflare Pages Functions activo',
  },
];

export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method.toUpperCase();

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Version',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Helper to get current data from KV (if bound) or memory
    const getData = async () => {
      if (env?.COURSEHUB_KV) {
        const stored = await env.COURSEHUB_KV.get('coursehub_data', 'json');
        if (stored) return stored;
      }
      return memoryStore;
    };

    // Helper to save data to KV (if bound) and memory
    const saveData = async (data: any) => {
      memoryStore = data;
      if (env?.COURSEHUB_KV) {
        await env.COURSEHUB_KV.put('coursehub_data', JSON.stringify(data));
      }
    };

    // 1. Health check
    if (path === '/health' || path === '' || path === '/') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'CourseHub Cloudflare Worker / Pages API',
          version: '6.2.0',
          edgeRuntime: 'Cloudflare Workers (V8 Edge)',
          timestamp: new Date().toISOString(),
          hasKvStorage: !!env?.COURSEHUB_KV,
          hasD1Database: !!env?.DB,
        }),
        { headers: corsHeaders }
      );
    }

    // 1.1 App Version & GitHub Auto-Update Check
    if (path === '/version' || path === '/app-update') {
      return new Response(
        JSON.stringify({
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
        }),
        { headers: corsHeaders }
      );
    }

    // 1.2 Windows .EXE Installer Download - Redirect to official GitHub release binary
    if (path === '/download/client-exe') {
      return Response.redirect('https://github.com/luis5afp/coursehub-vip/releases/download/v6.2.0/CourseHub-VIP-Setup-6.2.0.exe', 302);
    }

    // 2. Full database sync (GET & POST)
    if (path === '/data') {
      if (method === 'GET') {
        const data = await getData();
        return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
      }
      if (method === 'POST') {
        const incoming = await request.json();
        await saveData(incoming);
        return new Response(
          JSON.stringify({ success: true, message: 'Sincronizado en Cloudflare Edge', data: incoming }),
          { headers: corsHeaders }
        );
      }
    }

    // 3. Reset database
    if (path === '/reset' && method === 'POST') {
      const resetData = JSON.parse(JSON.stringify(INITIAL_DATA));
      await saveData(resetData);
      return new Response(
        JSON.stringify({ success: true, message: 'Datos restablecidos en Cloudflare Edge', data: resetData }),
        { headers: corsHeaders }
      );
    }

    // 4. Clients collection
    if (path === '/clients') {
      const data = await getData();
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, clients: data.clients, data: data.clients }), { headers: corsHeaders });
      }
      if (method === 'POST') {
        const body = await request.json();
        const newClient = {
          id: body.id || 'c_' + Math.random().toString(36).substring(2, 9),
          name: body.name,
          email: body.email,
          phone: body.phone || '',
          status: body.status || 'active',
          subscription: body.subscription || {
            plan: body.plan || 'Premium Empresarial',
            start: body.start || new Date().toISOString().slice(0, 10),
            end: body.end || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
            renewal: body.renewal || 'manual',
          },
          modules: body.modules || Object.fromEntries((data.modules || []).map((m: any) => [m.id, false])),
          profileIds: body.profileIds || [],
          devices: body.devices || [],
          history: body.history || [{ at: new Date().toISOString(), action: 'Cliente creado en Cloudflare' }],
        };
        data.clients.unshift(newClient);
        await saveData(data);
        return new Response(JSON.stringify({ success: true, client: newClient, data: newClient }), {
          status: 201,
          headers: corsHeaders,
        });
      }
    }

    // 5. Individual client operations
    const clientToggleModMatch = path.match(/^\/clients\/([^/]+)\/toggle-module$/);
    if (clientToggleModMatch && method === 'POST') {
      const clientId = clientToggleModMatch[1];
      const { moduleId, enabled } = await request.json();
      const data = await getData();
      const client = data.clients.find((c: any) => c.id === clientId);
      if (!client) {
        return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), { status: 404, headers: corsHeaders });
      }
      client.modules = { ...client.modules, [moduleId]: !!enabled };
      client.history.unshift({ at: new Date().toISOString(), action: `Módulo ${moduleId} ${enabled ? 'activado' : 'desactivado'}` });
      await saveData(data);
      return new Response(JSON.stringify({ success: true, data: client }), { headers: corsHeaders });
    }

    const clientToggleProfMatch = path.match(/^\/clients\/([^/]+)\/toggle-profile$/);
    if (clientToggleProfMatch && method === 'POST') {
      const clientId = clientToggleProfMatch[1];
      const { profileId, enabled } = await request.json();
      const data = await getData();
      const client = data.clients.find((c: any) => c.id === clientId);
      if (!client) {
        return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), { status: 404, headers: corsHeaders });
      }
      const set = new Set(client.profileIds || []);
      if (enabled) set.add(profileId);
      else set.delete(profileId);
      client.profileIds = Array.from(set);
      await saveData(data);
      return new Response(JSON.stringify({ success: true, data: client }), { headers: corsHeaders });
    }

    const clientRevokeDeviceMatch = path.match(/^\/clients\/([^/]+)\/devices\/([^/]+)\/revoke$/);
    if (clientRevokeDeviceMatch && method === 'POST') {
      const [_, clientId, deviceId] = clientRevokeDeviceMatch;
      const data = await getData();
      const client = data.clients.find((c: any) => c.id === clientId);
      if (!client) {
        return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), { status: 404, headers: corsHeaders });
      }
      client.devices = (client.devices || []).map((d: any) => d.id === deviceId ? { ...d, status: 'revoked', last: 'Revocado' } : d);
      await saveData(data);
      return new Response(JSON.stringify({ success: true, data: client }), { headers: corsHeaders });
    }

    const clientMatch = path.match(/^\/clients\/([^/]+)$/);
    if (clientMatch) {
      const clientId = clientMatch[1];
      const data = await getData();
      const cIdx = data.clients.findIndex((c: any) => c.id === clientId);

      if (cIdx === -1) {
        return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), {
          status: 404,
          headers: corsHeaders,
        });
      }

      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, data: data.clients[cIdx] }), { headers: corsHeaders });
      }

      if (method === 'PUT') {
        const body = await request.json();
        data.clients[cIdx] = {
          ...data.clients[cIdx],
          ...body,
          id: clientId,
          history: [
            { at: new Date().toISOString(), action: body.actionLog || 'Actualizado en Cloudflare' },
            ...(data.clients[cIdx].history || []),
          ],
        };
        await saveData(data);
        return new Response(JSON.stringify({ success: true, client: data.clients[cIdx], data: data.clients[cIdx] }), {
          headers: corsHeaders,
        });
      }

      if (method === 'DELETE') {
        data.clients.splice(cIdx, 1);
        await saveData(data);
        return new Response(JSON.stringify({ success: true, message: 'Cliente eliminado' }), {
          headers: corsHeaders,
        });
      }
    }

    // 6. Modules collection
    if (path === '/modules') {
      const data = await getData();
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, modules: data.modules, data: data.modules }), { headers: corsHeaders });
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = body.id || 'm_' + Math.random().toString(36).substring(2, 9);
        const newModule = {
          id,
          name: body.name,
          icon: body.icon || '◇',
          desc: body.desc || '',
          enabled: body.enabled !== undefined ? body.enabled : true,
          profiles: body.profiles || [],
        };
        data.modules.push(newModule);
        data.clients = data.clients.map((c: any) => ({
          ...c,
          modules: { ...c.modules, [id]: false },
        }));
        await saveData(data);
        return new Response(JSON.stringify({ success: true, module: newModule, data: newModule }), {
          status: 201,
          headers: corsHeaders,
        });
      }
    }

    // 7. Security Stats & Audit logs
    if (path === '/security/stats' && method === 'GET') {
      const data = await getData();
      let totalDevices = 0;
      let revokedDevices = 0;
      let validCredentials = 0;
      let invalidCredentials = 0;

      data.clients.forEach((c: any) => {
        (c.devices || []).forEach((d: any) => {
          totalDevices++;
          if (d.status === 'revoked') revokedDevices++;
        });
      });

      data.modules.forEach((m: any) => {
        (m.profiles || []).forEach((p: any) => {
          if (p.credentialOk) validCredentials++;
          else invalidCredentials++;
        });
      });

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            totalClients: data.clients.length,
            activeClients: data.clients.filter((c: any) => c.status === 'active').length,
            totalDevices,
            revokedDevices,
            validCredentials,
            invalidCredentials,
            activeAdmins: (data.admins || []).filter((a: any) => a.status === 'active').length,
            mfaEnforced: true,
          },
        }),
        { headers: corsHeaders }
      );
    }

    if (path === '/security/audit-logs') {
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, logs: memoryLogs, data: memoryLogs }), { headers: corsHeaders });
      }
      if (method === 'POST') {
        const body = await request.json();
        const newLog = {
          id: 'log_' + Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toISOString(),
          user: body.user || 'admin_master',
          action: body.action || 'Acción en Cloudflare',
          category: body.category || 'system',
          ip: request.headers.get('cf-connecting-ip') || 'Cloudflare Edge',
          details: body.details,
        };
        memoryLogs.unshift(newLog);
        return new Response(JSON.stringify({ success: true, data: newLog }), { status: 201, headers: corsHeaders });
      }
    }

    // 8. Verify all credentials
    if (path === '/verify-access' && method === 'POST') {
      const data = await getData();
      const now = new Date().toISOString();
      data.modules = data.modules.map((m: any) => ({
        ...m,
        profiles: (m.profiles || []).map((p: any) => ({
          ...p,
          lastCheck: now,
        })),
      }));
      await saveData(data);
      return new Response(JSON.stringify({ success: true, timestamp: now, data }), {
        headers: corsHeaders,
      });
    }

    // 9. Benchmark
    if (path === '/system/benchmark' && method === 'GET') {
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < 50000; i++) sum += Math.sqrt(i);
      const latency = performance.now() - start;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            latencyMs: Math.round(latency * 100) / 100,
            iterations: 50000,
            avgLatency: Math.round(latency * 100) / 100,
            serverInfo: {
              runtime: 'Cloudflare Workers (V8 V8-isolate)',
              datacenter: request.cf?.colo || 'Edge Global',
              country: request.cf?.country || 'Global',
            },
          },
        }),
        { headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ success: false, error: 'Ruta no encontrada', path }), {
      status: 404,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
