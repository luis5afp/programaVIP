import { useEffect, useState } from 'react';
import { CheckCircle2, Database, Download, KeyRound, PackageCheck, RefreshCw, ServerCog, XCircle } from 'lucide-react';
import { api } from '../api';
import type { AdminSession, ClientReleaseStatus, HealthInfo } from '../types';
import { Badge, Card, ErrorBanner, PageHead, SuccessBanner } from '../components/ui';

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function SystemView({ session }: { session: AdminSession }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [release, setRelease] = useState<ClientReleaseStatus | null>(null);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [savingRelease, setSavingRelease] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadRelease() {
    try {
      setLoadingRelease(true);
      const result = await api.clientRelease.get();
      setRelease(result);
      setSelectedVersion((current) => current || result.active.version);
    } catch (loadError: any) {
      setError(loadError.message);
    } finally {
      setLoadingRelease(false);
    }
  }

  useEffect(() => {
    api.health().then(setHealth).catch((loadError) => setError(loadError.message));
    void loadRelease();
  }, []);

  async function activateVersion() {
    if (!selectedVersion || selectedVersion === release?.active.version) return;
    try {
      setSavingRelease(true);
      setError(null);
      setSuccess(null);
      const result = await api.clientRelease.activate(selectedVersion);
      setRelease(result);
      setSelectedVersion(result.active.version);
      setSuccess(`Versión v${result.active.version} activada correctamente.`);
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setSavingRelease(false);
    }
  }

  const active = release?.active;
  const available = release?.available || [];

  return (
    <>
      <PageHead title="Servidor & Sistema" description="Diagnóstico del Worker y control de la versión de userFLOW publicada para los clientes." />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid two">
        <Card className="card-pad">
          <ServerCog size={20} />
          <h3>Cloudflare Worker</h3>
          <p className="muted">Servicio: {health?.service || '—'}</p>
          <Badge tone={health?.ok ? 'ok' : 'bad'}>
            {health?.ok ? <><CheckCircle2 size={10} />Online</> : <><XCircle size={10} />Sin respuesta</>}
          </Badge>
        </Card>

        <Card className="card-pad">
          <Database size={20} />
          <h3>CREATORTOOLS LAB</h3>
          <p className="muted">Supabase service-role configurado como secreto del Worker.</p>
          <Badge tone={health?.supabaseConfigured ? 'ok' : 'bad'}>{health?.supabaseConfigured ? 'Configurado' : 'Falta configurar'}</Badge>
        </Card>

        <Card className="card-pad">
          <KeyRound size={20} />
          <h3>Cifrado de proxy</h3>
          <p className="muted">AES-GCM con una clave exclusiva guardada en Cloudflare Secrets.</p>
          <Badge tone={health?.proxyEncryptionConfigured ? 'ok' : 'warn'}>{health?.proxyEncryptionConfigured ? 'Configurado' : 'Pendiente'}</Badge>
        </Card>

        <Card className="card-pad">
          <Database size={20} />
          <h3>Versión del servidor</h3>
          <p className="mono muted">{health?.version || '1.0.0'}</p>
          <div className="toolbar" style={{ margin: '8px 0 0' }}>
            <Badge tone="neutral">userFLOW ≥ {health?.minimumClientVersion || '—'}</Badge>
            <Badge tone="neutral">Session Manager ≥ {health?.minimumSessionManagerVersion || '—'}</Badge>
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            userFLOW y Session Manager tienen versiones independientes. Actualizar uno no modifica el otro mientras ambos cumplan su versión mínima compatible.
          </p>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}><Card className="card-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <PackageCheck size={22} />
            <h3 style={{ marginBottom: 4 }}>Versión de userFLOW para clientes</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Esta es solo la versión de userFLOW que devuelve <span className="mono">/api/client-update/latest</span>. No instala ni actualiza Session Manager.
            </p>
          </div>
          <button className="button secondary small" disabled={loadingRelease} onClick={() => void loadRelease()}>
            <RefreshCw size={13} />
            {loadingRelease ? 'Consultando...' : 'Actualizar estado'}
          </button>
        </div>

        {active ? (
          <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
            <div className="toolbar" style={{ margin: 0 }}>
              <Badge tone={release?.activeCompatible === false ? 'bad' : 'ok'}>Activa: v{active.version}</Badge>
              {release?.minimumCompatibleVersion && (
                <Badge tone={release.activeCompatible === false ? 'bad' : 'neutral'}>
                  Mínima compatible: v{release.minimumCompatibleVersion}
                </Badge>
              )}
              <Badge tone="neutral">{formatBytes(active.size)}</Badge>
              <Badge tone="neutral">{active.chunks.length} partes</Badge>
              {active.publishedAt && <Badge tone="neutral">{new Date(active.publishedAt).toLocaleString('es-PE')}</Badge>}
            </div>

            {release?.activeCompatible === false && (
              <div style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10, color: '#991b1b' }}>
                La versión activa es incompatible con el servidor. Activa una versión igual o superior a v{release.minimumCompatibleVersion}.
              </div>
            )}
            <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <div className="help">SHA-256 del instalador</div>
              <div className="mono" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{active.sha256}</div>
            </div>

            <div className="grid two" style={{ alignItems: 'end' }}>
              <label>
                <span className="field-label">Versión publicada</span>
                <select
                  className="select"
                  value={selectedVersion}
                  onChange={(event) => setSelectedVersion(event.target.value)}
                  disabled={session.role !== 'owner' || available.length === 0}
                >
                  {available.map((item) => (
                    <option value={item.version} key={item.version}>
                      {item.version}{item.version === active.version ? ' · activa' : ''}
                    </option>
                  ))}
                </select>
                <span className="help">
                  Solo aparecen versiones con manifiesto y chunks publicados. Cambiar aquí modifica el canal de actualización real.
                </span>
              </label>

              <div className="toolbar" style={{ margin: 0 }}>
                {release?.downloadUrl && (
                  <a className="button secondary" href={release.downloadUrl} target="_blank" rel="noreferrer">
                    <Download size={14} />
                    Descargar v{active.version}
                  </a>
                )}
                {session.role === 'owner' && (
                  <button
                    className="button primary"
                    disabled={savingRelease || !selectedVersion || selectedVersion === active.version}
                    onClick={() => void activateVersion()}
                  >
                    <PackageCheck size={14} />
                    {savingRelease ? 'Activando...' : 'Activar versión'}
                  </button>
                )}
              </div>
            </div>

            {session.role !== 'owner' && (
              <p className="help">Solo el propietario puede cambiar la versión activa. Los administradores pueden consultar el estado y descargarla.</p>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>{loadingRelease ? 'Consultando versión activa…' : 'No se pudo leer el manifiesto de actualización.'}</p>
        )}
      </Card></div>
    </>
  );
}
