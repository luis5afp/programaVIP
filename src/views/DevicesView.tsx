import { useEffect, useState } from 'react';
import { Laptop, RotateCcw, ShieldX } from 'lucide-react';
import { api } from '../api';
import type { Device } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

export function DevicesView() {
  const [items, setItems] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <PageHead
        title="Dispositivos"
        description="Equipos registrados por userFLEX Client. La identidad se guarda como hash y la reactivación respeta el límite del plan."
      />
      <ErrorBanner message={error} />
      <Card>
        {items.length === 0 ? (
          <Empty title="Sin dispositivos" description="Aparecerán cuando un Client se autentique desde Windows." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Cliente</th>
                  <th>Sistema</th>
                  <th>Última conexión</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="table-primary">
                      <Laptop size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                      {item.name}
                    </td>
                    <td>{item.client?.name || item.client_id}</td>
                    <td>{item.os || '—'}</td>
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
