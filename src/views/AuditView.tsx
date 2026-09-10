import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuditLog } from '../types';
import { Badge, Card, Empty, ErrorBanner, PageHead } from '../components/ui';

export function AuditView() {
  const [items, setItems] = useState<AuditLog[]>([]); const [error, setError] = useState<string | null>(null); useEffect(() => { api.audit.list().then(setItems).catch((e) => setError(e.message)); }, []);
  return <><PageHead title="Auditoría" description="Registro del servidor sin contraseñas, cookies, tokens ni claves de proxy." /><ErrorBanner message={error} /><Card>{items.length === 0 ? <Empty title="Sin eventos" description="Las acciones administrativas y accesos del Client aparecerán aquí." /> : <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Detalles</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td><Badge>{item.actor_type}</Badge></td><td className="table-primary">{item.action}</td><td>{item.entity_type || '—'}</td><td className="mono" style={{ fontSize: 10 }}>{Object.keys(item.details || {}).length ? JSON.stringify(item.details) : '—'}</td></tr>)}</tbody></table></div>}</Card></>;
}
