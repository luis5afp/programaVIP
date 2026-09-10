import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { AdminSession, ViewKey } from './types';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { DashboardView } from './views/DashboardView';
import { ClientsView } from './views/ClientsView';
import { PlansView } from './views/PlansView';
import { ProfilesView } from './views/ProfilesView';
import { ProxiesView } from './views/ProxiesView';
import { AssignmentsView } from './views/AssignmentsView';
import { DevicesView } from './views/DevicesView';
import { AuditView } from './views/AuditView';
import { SystemView } from './views/SystemView';

export default function App() {
  const [session, setSession] = useState<AdminSession | null | undefined>(undefined);
  const [view, setView] = useState<ViewKey>('dashboard');

  useEffect(() => {
    api.session()
      .then((result) => setSession(result.user))
      .catch((error: ApiError) => {
        if (error.status === 401) setSession(null);
        else setSession(null);
      });
  }, []);

  async function logout() {
    try { await api.logout(); } finally { setSession(null); setView('dashboard'); }
  }

  if (session === undefined) {
    return <main className="login-screen"><div className="login-card" style={{ textAlign: 'center' }}>Verificando sesión segura…</div></main>;
  }
  if (!session) return <Login onSuccess={setSession} />;

  let content;
  switch (view) {
    case 'clients': content = <ClientsView />; break;
    case 'plans': content = <PlansView />; break;
    case 'profiles': content = <ProfilesView />; break;
    case 'proxies': content = <ProxiesView />; break;
    case 'assignments': content = <AssignmentsView />; break;
    case 'devices': content = <DevicesView />; break;
    case 'audit': content = <AuditView />; break;
    case 'system': content = <SystemView />; break;
    default: content = <DashboardView />;
  }

  return <Layout session={session} view={view} onView={setView} onLogout={logout}>{content}</Layout>;
}
