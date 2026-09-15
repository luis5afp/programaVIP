import fs from 'node:fs';

function mustReplace(file, from, to) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`Pattern not found in ${file}: ${from.slice(0, 120)}`);
  fs.writeFileSync(file, source.replace(from, to));
}

const authFile = 'cloudflare/lib/auth.ts';
mustReplace(
  authFile,
  "const stamp=new Date().toISOString();void sb(env,`userflex_client_sessions?id=eq.${session.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_seen_at:stamp})}).catch(()=>{});void sb(env,`userflex_devices?id=eq.${session.device_id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_seen_at:stamp})}).catch(()=>{});return{clientId:session.client_id,deviceId:session.device_id,sessionId:session.id,client:clients[0],plan,subscription}",
  "const stamp=new Date().toISOString(),clientIp=request.headers.get('cf-connecting-ip');void sb(env,`userflex_client_sessions?id=eq.${session.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_seen_at:stamp})}).catch(()=>{});void sb(env,`userflex_devices?id=eq.${session.device_id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_seen_at:stamp,...(clientIp?{last_ip:clientIp}:{})})}).catch(()=>{});return{clientId:session.client_id,deviceId:session.device_id,sessionId:session.id,client:clients[0],plan,subscription}"
);
mustReplace(
  authFile,
  "if(device.status==='limit_reached')throw new HttpError(403,'DEVICE_LIMIT_REACHED','Se alcanzó el máximo de dispositivos del plan.');const raw=token(),hash=await sha(raw),expiresAt=new Date(Date.now()+CLIENT_SESSION_SECONDS*1000).toISOString();",
  "if(device.status==='limit_reached')throw new HttpError(403,'DEVICE_LIMIT_REACHED','Se alcanzó el máximo de dispositivos del plan.');const clientIp=request.headers.get('cf-connecting-ip');if(clientIp)await sb(env,`userflex_devices?id=eq.${device.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_ip:clientIp,last_seen_at:new Date().toISOString()})});const raw=token(),hash=await sha(raw),expiresAt=new Date(Date.now()+CLIENT_SESSION_SECONDS*1000).toISOString();"
);

const adminFile = 'cloudflare/lib/admin.ts';
mustReplace(
  adminFile,
  "userflex_devices?select=id,client_id,name,os,status,last_seen_at,created_at&order=last_seen_at.desc.nullslast",
  "userflex_devices?select=id,client_id,name,os,status,last_ip,last_seen_at,created_at&order=last_seen_at.desc.nullslast"
);
mustReplace(
  adminFile,
  "userflex_devices?select=id,client_id,name,os,status,last_seen_at,created_at&id=eq.${deviceId}&limit=1",
  "userflex_devices?select=id,client_id,name,os,status,last_ip,last_seen_at,created_at&id=eq.${deviceId}&limit=1"
);

const typesFile = 'src/types.ts';
mustReplace(
  typesFile,
  "  os: string | null;\n  status: DeviceStatus;\n  last_seen_at: string | null;",
  "  os: string | null;\n  status: DeviceStatus;\n  last_ip: string | null;\n  last_seen_at: string | null;"
);

fs.writeFileSync('src/views/DevicesView.tsx', `import { useEffect, useMemo, useState } from 'react';
import { Laptop, RotateCcw, Search, ShieldX } from 'lucide-react';
import { api } from '../api';
import type { Device } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLocaleLowerCase('es');
}

export function DevicesView() {
  const [items, setItems] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function load() {
    try {
      setItems(await api.devices.list());
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(item: Device) {
    if (!confirm(\`¿Revocar \${item.name}? Se invalidarán sus sesiones activas.\`)) return;
    try {
      await api.devices.revoke(item.id);
      await load();
    } catch (revokeError: any) {
      setError(revokeError.message);
    }
  }

  async function reactivate(item: Device) {
    if (!confirm(\`¿Reactivar \${item.name}? El límite del plan se validará antes de autorizarlo.\`)) return;
    try {
      await api.devices.reactivate(item.id);
      await load();
    } catch (reactivateError: any) {
      setError(reactivateError.message);
    }
  }

  const filteredItems = useMemo(() => {
    const query = normalizeSearchValue(searchQuery.trim());
    if (!query) return items;
    return items.filter((item) => {
      const searchable = [
        item.name,
        item.client?.name || '',
        item.client?.email || '',
        item.os || '',
        item.last_ip || '',
        item.status,
        item.status === 'active' ? 'activo' : 'revocado',
      ].join(' ');
      return normalizeSearchValue(searchable).includes(query);
    });
  }, [items, searchQuery]);

  return (
    <>
      <PageHead
        title="Dispositivos"
        description="Equipos registrados por userFLEX Client. Muestra la última IP pública observada por el servidor; la identidad del equipo continúa guardándose como hash."
        actions={
          <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, color: '#94a3b8', pointerEvents: 'none' }} />
            <input
              className="input"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar IP, cliente, dispositivo..."
              aria-label="Buscar dispositivos"
              autoComplete="off"
              style={{ width: 320, paddingLeft: 34 }}
            />
          </label>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {items.length === 0 ? (
          <Empty title="Sin dispositivos" description="Aparecerán cuando un Client se autentique desde Windows." />
        ) : filteredItems.length === 0 ? (
          <Empty title="Sin coincidencias" description={\`No hay dispositivos que coincidan con “\${searchQuery.trim()}”.\`} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Cliente</th>
                  <th>Sistema</th>
                  <th>Última IP</th>
                  <th>Última conexión</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="table-primary">
                      <Laptop size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                      {item.name}
                    </td>
                    <td>
                      <div className="table-primary">{item.client?.name || item.client_id}</div>
                      {item.client?.email && <div className="table-secondary">{item.client.email}</div>}
                    </td>
                    <td>{item.os || '—'}</td>
                    <td className="mono">{item.last_ip || '—'}</td>
                    <td>{item.last_seen_at ? new Date(item.last_seen_at).toLocaleString() : 'Nunca'}</td>
                    <td><Badge tone={item.status === 'active' ? 'ok' : 'bad'}>{item.status === 'active' ? 'Activo' : 'Revocado'}</Badge></td>
                    <td>
                      {item.status === 'active' ? (
                        <button className="button danger small" onClick={() => void revoke(item)}>
                          <ShieldX size={12} />
                          Revocar
                        </button>
                      ) : (
                        <button className="button secondary small" onClick={() => void reactivate(item)}>
                          <RotateCcw size={12} />
                          Reactivar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
`);

mustReplace('cloudflare/worker.ts', "const APP_VERSION = '1.2.4';", "const APP_VERSION = '1.2.5';");
