import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Cable,
  CircleUserRound,
  Gauge,
  Globe2,
  Laptop,
  LogOut,
  Network,
  Puzzle,
  ServerCog,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react';
import type { AdminSession, SessionAlertSummary, ViewKey } from '../types';

const items: Array<{ id: ViewKey; label: string; icon: typeof Gauge; ownerOnly?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'plans', label: 'Planes', icon: WalletCards },
  { id: 'profiles', label: 'Perfiles / Webs', icon: Globe2 },
  { id: 'extensions', label: 'Extensiones', icon: Puzzle },
  { id: 'proxies', label: 'Proxies', icon: Network },
  { id: 'assignments', label: 'Asignaciones', icon: Cable },
  { id: 'devices', label: 'Dispositivos', icon: Laptop },
  { id: 'activity', label: 'Actividad', icon: Activity },
  { id: 'administrators', label: 'Administradores', icon: UserCog, ownerOnly: true },
  { id: 'system', label: 'Servidor & Sistema', icon: ServerCog },
];

export function Layout({
  session,
  view,
  sessionAlerts,
  onView,
  onLogout,
  children,
}: {
  session: AdminSession;
  view: ViewKey;
  sessionAlerts: SessionAlertSummary | null;
  onView: (view: ViewKey) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const visibleItems = items.filter((item) => !item.ownerOnly || session.role === 'owner');
  const active = items.find((item) => item.id === view) || items[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">uF</div><div><strong>userFLEX</strong><span>Admin Console</span></div></div>
        <div><div className="nav-section-title">Administración</div><nav className="nav-list">{visibleItems.map((item) => { const Icon = item.icon; return <button className={`nav-btn ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => onView(item.id)}><Icon size={16} /> {item.label}</button>; })}</nav></div>
        <div className="sidebar-footer"><div className="admin-chip"><div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}><CircleUserRound size={20} /><div style={{ minWidth: 0 }}><strong style={{ fontSize: 11 }}>{session.display_name || session.username}</strong><small>{session.role === 'owner' ? 'Propietario' : 'Administrador'} · {session.username}</small></div></div><button className="icon-button" type="button" onClick={onLogout} title="Cerrar sesión"><LogOut size={15} /></button></div></div>
      </aside>
      <section className="main">
        <header className="topbar">
          <div><h1>{active.label}</h1><p>Cloudflare Worker + Supabase CREATORTOOLS LAB</p></div>
          <div className="connection"><span className="connection-dot" /><Activity size={14} />Servidor</div>
        </header>
        {sessionAlerts && sessionAlerts.count > 0 && (
          <div className={`session-alert-banner ${sessionAlerts.criticalCount > 0 ? 'critical' : 'warning'}`}>
            <div className="session-alert-icon"><AlertTriangle size={18} /></div>
            <div className="session-alert-copy">
              <strong>
                {sessionAlerts.criticalCount > 0
                  ? `${sessionAlerts.criticalCount} perfil${sessionAlerts.criticalCount === 1 ? '' : 'es'} necesita${sessionAlerts.criticalCount === 1 ? '' : 'n'} renovar o validar sesión`
                  : `${sessionAlerts.warningCount} perfil${sessionAlerts.warningCount === 1 ? '' : 'es'} conviene${sessionAlerts.warningCount === 1 ? '' : 'n'} validar pronto`}
              </strong>
              <span>
                {sessionAlerts.profiles.slice(0, 4).map((item) => item.profile_name).join(' · ')}
                {sessionAlerts.profiles.length > 4 ? ` · +${sessionAlerts.profiles.length - 4} más` : ''}
              </span>
            </div>
            <button className="button small secondary session-alert-action" type="button" onClick={() => onView('profiles')}>
              Revisar perfiles
            </button>
          </div>
        )}
        <div className="content">{children}</div>
      </section>
    </div>
  );
}
