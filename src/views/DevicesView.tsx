import { useEffect, useMemo, useState } from 'react';
import { Laptop, RotateCcw, Search, ShieldX } from 'lucide-react';
import { api } from '../api';
import type { Device } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
    if (!confirm(`¿Revocar ${item.name}? Se invalidarán sus sesiones activas.`)) return;
    try {
      await api.devices.revoke(item.id);
      await load();
    } catch (revokeError: any) {
      setError(revokeError.message);
    }
  }

  async function reactivate(item: Device) {
    if (!confirm(`¿Reactivar ${item.name}? El límite del plan se validará antes de autorizarlo.`)) return;
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
          <Empty title="Sin coincidencias" description={`No hay dispositivos que coincidan con “${searchQuery.trim()}”.`} />
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
