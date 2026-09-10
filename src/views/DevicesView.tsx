import { useEffect, useState } from 'react';
import { Laptop, ShieldX } from 'lucide-react';
import { api } from '../api';
import type { Device } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

export function DevicesView() {
  const [items, setItems] = useState<Device[]>([]); const [error, setError] = useState<string | null>(null); async function load() { try { setItems(await api.devices.list()); } catch (e: any) { setError(e.message); } } useEffect(() => { void load(); }, []);
  async function revoke(item: Device) { if (!confirm(`¿Revocar ${item.name}? Se invalidarán sus sesiones activas.`)) return; try { await api.devices.revoke(item.id); await load(); } catch (e: any) { setError(e.message); } }
  return <><PageHead title="Dispositivos" description="Equipos registrados por userFLEX Client. La identidad del dispositivo se guarda como hash, no como un fingerprint invasivo." /><ErrorBanner message={error} /><Card>{items.length === 0 ? <Empty title="Sin dispositivos" description="Aparecerán cuando un Client se autentique desde Windows." /> : <div className="table-wrap"><table><thead><tr><th>Dispositivo</th><th>Cliente</th><th>Sistema</th><th>Última conexión</th><th>Estado</th><th /></tr></thead><tbody>{items.map((d) => <tr key={d.id}><td className="table-primary"><Laptop size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{d.name}</td><td>{d.client?.name || d.client_id}</td><td>{d.os || '—'}</td><td>{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'Nunca'}</td><td><Badge tone={d.status === 'active' ? 'ok' : 'bad'}>{d.status === 'active' ? 'Activo' : 'Revocado'}</Badge></td><td>{d.status === 'active' && <button className="button danger small" onClick={() => revoke(d)}><ShieldX size={12} />Revocar</button>}</td></tr>)}</tbody></table></div>}</Card></>;
}
