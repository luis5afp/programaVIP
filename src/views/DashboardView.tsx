import { useEffect, useState } from 'react';
import { Cable, Globe2, Laptop, Network, Users, WalletCards } from 'lucide-react';
import { api } from '../api';
import type { DashboardStats } from '../types';
import { Card, ErrorBanner, PageHead } from '../components/ui';

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.dashboard().then(setStats).catch((e) => setError(e.message)); }, []);
  const cards = [
    ['Clientes activos', stats?.activeClients ?? '—', Users], ['Planes', stats?.plans ?? '—', WalletCards], ['Perfiles / Webs', stats?.profiles ?? '—', Globe2], ['Proxies', stats?.proxies ?? '—', Network], ['Dispositivos activos', stats?.activeDevices ?? '—', Laptop], ['Asignaciones', stats?.assignments ?? '—', Cable],
  ] as const;
  return <><PageHead title="Dashboard" description="Estado real del servicio userFLEX. Los números provienen de Supabase; no hay datos de demostración." /><ErrorBanner message={error} /><div className="grid stats">{cards.map(([label, value, Icon]) => <Card className="stat-card" key={label}><div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div><div className="stat-icon"><Icon size={18} /></div></Card>)}</div><div className="grid two" style={{ marginTop: 16 }}><Card className="card-pad"><strong>Arquitectura activa</strong><p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>El panel habla únicamente con el Cloudflare Worker. El Worker es quien accede a CREATORTOOLS LAB con la clave service-role protegida como secreto.</p></Card><Card className="card-pad"><strong>Entrega al Client</strong><p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>El catálogo del Client se controla por cliente, suscripción, asignación y dispositivo. Los secretos de proxy no aparecen en el panel ni en el catálogo público del Client.</p></Card></div></>;
}
