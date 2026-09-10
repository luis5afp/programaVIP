import { useEffect, useState } from 'react';
import { CheckCircle2, Database, KeyRound, ServerCog, XCircle } from 'lucide-react';
import { api } from '../api';
import type { HealthInfo } from '../types';
import { Badge, Card, ErrorBanner, PageHead } from '../components/ui';

export function SystemView() {
  const [health, setHealth] = useState<HealthInfo | null>(null); const [error, setError] = useState<string | null>(null); useEffect(() => { api.health().then(setHealth).catch((e) => setError(e.message)); }, []);
  return <><PageHead title="Servidor & Sistema" description="Diagnóstico del Cloudflare Worker y configuración necesaria para producción." /><ErrorBanner message={error} /><div className="grid two"><Card className="card-pad"><ServerCog size={20} /><h3>Cloudflare Worker</h3><p className="muted">Servicio: {health?.service || '—'}</p><Badge tone={health?.ok ? 'ok' : 'bad'}>{health?.ok ? <><CheckCircle2 size={10} />Online</> : <><XCircle size={10} />Sin respuesta</>}</Badge></Card><Card className="card-pad"><Database size={20} /><h3>CREATORTOOLS LAB</h3><p className="muted">Supabase service-role configurado como secreto del Worker.</p><Badge tone={health?.supabaseConfigured ? 'ok' : 'bad'}>{health?.supabaseConfigured ? 'Configurado' : 'Falta configurar'}</Badge></Card><Card className="card-pad"><KeyRound size={20} /><h3>Cifrado de proxy</h3><p className="muted">AES-GCM con una clave exclusiva guardada en Cloudflare Secrets.</p><Badge tone={health?.proxyEncryptionConfigured ? 'ok' : 'warn'}>{health?.proxyEncryptionConfigured ? 'Configurado' : 'Pendiente'}</Badge></Card><Card className="card-pad"><Database size={20} /><h3>Versión</h3><p className="mono muted">{health?.version || '1.0.0'}</p><p className="muted" style={{ fontSize: 11 }}>Sin D1, KV ni servidor Express duplicado.</p></Card></div></>;
}
