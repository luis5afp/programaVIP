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
import { ActivityView } from './views/ActivityView';
import { AdministratorsView } from './views/AdministratorsView';
import { SystemView } from './views/SystemView';

export default function App() {
  const [session, setSession] = useState<AdminSession | null | undefined>(undefined);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [historySearch, setHistorySearch] = useState('');
  const [activityTab, setActivityTab] = useState<'history' | 'audit'>('history');

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
    case 'clients': content = <ClientsView onHistory={(client) => { setHistorySearch(client.name); setActivityTab('history'); setView('activity'); }} />; break;
    case 'plans': content = <PlansView />; break;
    case 'profiles': content = <ProfilesView />; break;
    case 'proxies': content = <ProxiesView />; break;
    case 'assignments': content = <AssignmentsView />; break;
    case 'devices': content = <DevicesView />; break;
    case 'activity': content = <ActivityView initialTab={activityTab} initialHistorySearch={historySearch} />; break;
    case 'administrators': content = session.role === 'owner' ? <AdministratorsView session={session} /> : <DashboardView />; break;
    case 'system': content = <SystemView session={session} />; break;
    default: content = <DashboardView />;
  }

  return <Layout session={session} view={view} onView={(next) => { if (next === 'activity') { setHistorySearch(''); setActivityTab('history'); } setView(next); }} onLogout={logout}>{content}</Layout>;
}
