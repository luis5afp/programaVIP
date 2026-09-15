import type { ReactNode } from 'react';
import {
  Activity,
  Cable,
  CircleUserRound,
  Gauge,
  Globe2,
  History,
  Laptop,
  LogOut,
  Network,
  ServerCog,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import type { AdminSession, ViewKey } from '../types';

const items: Array<{ id: ViewKey; label: string; icon: typeof Gauge }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'plans', label: 'Planes', icon: WalletCards },
  { id: 'profiles', label: 'Perfiles / Webs', icon: Globe2 },
  { id: 'proxies', label: 'Proxies', icon: Network },
  { id: 'assignments', label: 'Asignaciones', icon: Cable },
  { id: 'devices', label: 'Dispositivos', icon: Laptop },
  { id: 'history', label: 'Historial', icon: History },
  { id: 'audit', label: 'Auditoría', icon: ShieldCheck },
  { id: 'system', label: 'Servidor & Sistema', icon: ServerCog },
];

export function Layout({ session, view, onView, onLogout, children }: { session: AdminSession; view: ViewKey; onView: (view: ViewKey) => void; onLogout: () => void; children: ReactNode; }) {
  const active = items.find((item) => item.id === view)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">uF</div><div><strong>userFLEX</strong><span>Admin Console</span></div></div>
        <div><div className="nav-section-title">Administración</div><nav className="nav-list">{items.map((item) => { const Icon = item.icon; return <button className={`nav-btn ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => onView(item.id)}><Icon size={16} /> {item.label}</button>; })}</nav></div>
        <div className="sidebar-footer"><div className="admin-chip"><div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}><CircleUserRound size={20} /><div style={{ minWidth: 0 }}><strong style={{ fontSize: 11 }}>{session.username}</strong><small>CREATORTOOLS LAB</small></div></div><button className="icon-button" type="button" onClick={onLogout} title="Cerrar sesión"><LogOut size={15} /></button></div></div>
      </aside>
      <section className="main"><header className="topbar"><div><h1>{active.label}</h1><p>Cloudflare Worker + Supabase CREATORTOOLS LAB</p></div><div className="connection"><span className="connection-dot" /><Activity size={14} />Servidor</div></header><div className="content">{children}</div></section>
    </div>
  );
}
