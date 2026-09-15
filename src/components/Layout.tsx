import type { ReactNode } from 'react';
import {
  Activity,
  Cable,
  CircleUserRound,
  Gauge,
  Globe2,
  Laptop,
  LogOut,
  Network,
  ServerCog,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react';
import type { AdminSession, ViewKey } from '../types';

const items: Array<{ id: ViewKey; label: string; icon: typeof Gauge; ownerOnly?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'plans', label: 'Planes', icon: WalletCards },
  { id: 'profiles', label: 'Perfiles / Webs', icon: Globe2 },
  { id: 'proxies', label: 'Proxies', icon: Network },
  { id: 'assignments', label: 'Asignaciones', icon: Cable },
  { id: 'devices', label: 'Dispositivos', icon: Laptop },
  { id: 'activity', label: 'Actividad', icon: Activity },
  { id: 'administrators', label: 'Administradores', icon: UserCog, ownerOnly: true },
  { id: 'system', label: 'Servidor & Sistema', icon: ServerCog },
];

export function Layout({ session, view, onView, onLogout, children }: { session: AdminSession; view: ViewKey; onView: (view: ViewKey) => void; onLogout: () => void; children: ReactNode; }) {
  const visibleItems = items.filter((item) => !item.ownerOnly || session.role === 'owner');
  const active = items.find((item) => item.id === view) || items[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">uF</div><div><strong>userFLEX</strong><span>Admin Console</span></div></div>
        <div><div className="nav-section-title">Administración</div><nav className="nav-list">{visibleItems.map((item) => { const Icon = item.icon; return <button className={`nav-btn ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => onView(item.id)}><Icon size={16} /> {item.label}</button>; })}</nav></div>
        <div className="sidebar-footer"><div className="admin-chip"><div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}><CircleUserRound size={20} /><div style={{ minWidth: 0 }}><strong style={{ fontSize: 11 }}>{session.display_name || session.username}</strong><small>{session.role === 'owner' ? 'Propietario' : 'Administrador'} · {session.username}</small></div></div><button className="icon-button" type="button" onClick={onLogout} title="Cerrar sesión"><LogOut size={15} /></button></div></div>
      </aside>
      <section className="main"><header className="topbar"><div><h1>{active.label}</h1><p>Cloudflare Worker + Supabase CREATORTOOLS LAB</p></div><div className="connection"><span className="connection-dot" /><Activity size={14} />Servidor</div></header><div className="content">{children}</div></section>
    </div>
  );
}
