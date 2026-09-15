import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { ProfileUsage } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function dateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-PE');
}

function durationLabel(row: ProfileUsage) {
  if (!row.closed_at) return 'En curso';
  const start = new Date(row.opened_at).getTime();
  const end = new Date(row.closed_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function reasonLabel(reason: string | null) {
  const labels: Record<string, string> = {
    profile_closed: 'Perfil cerrado',
    window_closed: 'Ventana cerrada',
    app_exit: 'Programa cerrado',
    logout: 'Cierre de sesión',
    launch_failed: 'Fallo al abrir',
    client_suspended: 'Cliente suspendido',
    device_revoked: 'Dispositivo revocado',
    credentials_reset: 'Credenciales cambiadas',
    subscription_changed: 'Plan modificado',
    client_deleted: 'Cliente eliminado',
  };
  return reason ? labels[reason] || reason : null;
}

export function HistoryView({ initialSearch = '' }: { initialSearch?: string }) {
  const [rows, setRows] = useState<ProfileUsage[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.profileUsage.list());
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSearchQuery(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    void load();
  }, []);

  const filteredRows = useMemo(() => {
    const query = normalizeSearchValue(searchQuery.trim());
    if (!query) return rows;
    return rows.filter((row) => {
      const searchable = [
        row.client_name,
        row.client_email || '',
        row.device_name || '',
        row.device_os || '',
        row.ip || '',
        row.profile_name,
        row.profile_url || '',
        row.client_version || '',
        row.close_reason || '',
        dateTime(row.opened_at),
        dateTime(row.closed_at),
      ].join(' ');
      return normalizeSearchValue(searchable).includes(query);
    });
  }, [rows, searchQuery]);

  return (
    <>
      <PageHead
        title="Historial"
        description="Registro de aperturas y cierres de perfiles por cliente, dispositivo e IP. El buscador filtra localmente sin generar peticiones adicionales al servidor."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, color: '#94a3b8', pointerEvents: 'none' }} />
              <input
                className="input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Cliente, dispositivo, IP, perfil, fecha..."
                aria-label="Buscar historial"
                autoComplete="off"
                style={{ width: 330, paddingLeft: 34 }}
              />
            </label>
            <button className="button secondary" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} />
              Actualizar
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {loading && rows.length === 0 ? (
          <Empty title="Cargando historial" description="Consultando los últimos accesos registrados." />
        ) : rows.length === 0 ? (
          <Empty title="Sin historial todavía" description="Los accesos empezarán a registrarse cuando los clientes usen una versión compatible de userFLOW." />
        ) : filteredRows.length === 0 ? (
          <Empty title="Sin coincidencias" description={`No hay registros que coincidan con “${searchQuery.trim()}”.`} />
        ) : (
          <div className="table-wrap">
            <table style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Perfil</th>
                  <th>Dispositivo</th>
                  <th>IP</th>
                  <th>Entrada</th>
                  <th>Cierre</th>
                  <th>Duración</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const reason = reasonLabel(row.close_reason);
                  const failed = row.close_reason === 'launch_failed';
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="table-primary">{row.client_name}</div>
                        <div className="table-secondary">{row.client_email || '—'}</div>
                      </td>
                      <td>
                        <div className="table-primary">{row.profile_name}</div>
                        <div className="table-secondary">{row.profile_url || '—'}</div>
                      </td>
                      <td>
                        <div className="table-primary">{row.device_name || 'Dispositivo'}</div>
                        <div className="table-secondary">{row.device_os || '—'}</div>
                      </td>
                      <td className="mono">{row.ip || '—'}</td>
                      <td>{dateTime(row.opened_at)}</td>
                      <td>{dateTime(row.closed_at)}</td>
                      <td>{durationLabel(row)}</td>
                      <td>
                        <Badge tone={!row.closed_at ? 'warn' : failed ? 'bad' : 'ok'}>
                          {!row.closed_at ? 'En uso / pendiente' : failed ? 'Fallo' : 'Cerrado'}
                        </Badge>
                        {reason ? <div className="table-secondary">{reason}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
