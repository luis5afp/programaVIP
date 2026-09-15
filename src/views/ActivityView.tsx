import { useEffect, useState } from 'react';
import { History, ShieldCheck } from 'lucide-react';
import { AuditView } from './AuditView';
import { HistoryView } from './HistoryView';

type ActivityTab = 'history' | 'audit';

export function ActivityView({
  initialTab = 'history',
  initialHistorySearch = '',
}: {
  initialTab?: ActivityTab;
  initialHistorySearch?: string;
}) {
  const [tab, setTab] = useState<ActivityTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 18 }} role="tablist" aria-label="Actividad">
        <button
          className={`button ${tab === 'history' ? 'primary' : 'secondary'}`}
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
        >
          <History size={14} />
          Historial de perfiles
        </button>
        <button
          className={`button ${tab === 'audit' ? 'primary' : 'secondary'}`}
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          onClick={() => setTab('audit')}
        >
          <ShieldCheck size={14} />
          Auditoría del sistema
        </button>
      </div>
      {tab === 'history' ? <HistoryView initialSearch={initialHistorySearch} /> : <AuditView />}
    </>
  );
}
