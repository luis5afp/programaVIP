import { FormEvent, useEffect, useState } from 'react';
import { Clock3, KeyRound, MapPin, Network, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { ProxyRecord, ProxyValidationStatus } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead, SuccessBanner } from '../components/ui';

type Editor = ProxyRecord | 'new' | null;

function flagEmoji(code: string | null) {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return '🌐';
  return code.toUpperCase().split('').map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

function validationLabel(status: ProxyValidationStatus) {
  if (status === 'valid') return 'Validado';
  if (status === 'reachable') return 'Alcanzable';
  if (status === 'invalid') return 'Inválido';
  if (status === 'unverifiable') return 'No verificable';
  return 'Pendiente';
}

function validationTone(status: ProxyValidationStatus): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'valid') return 'ok';
  if (status === 'invalid') return 'bad';
  if (status === 'reachable' || status === 'unverifiable') return 'warn';
  return 'neutral';
}

function protocolLabel(item: ProxyRecord) {
  return item.proxy_type === 'unknown' ? '—' : item.proxy_type.toUpperCase();
}

function locationLabel(item: ProxyRecord) {
  const parts = [item.city, item.region, item.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Ubicación pendiente';
}

function checkedLabel(value: string | null) {
  if (!value) return 'Sin comprobar';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sin comprobar';
  return date.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

export function ProxiesView() {
  const [items, setItems] = useState<ProxyRecord[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await api.proxies.list());
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const input = {
      name: String(form.get('name') || '').trim(),
      host: String(form.get('host') || '').trim(),
      port: Number(form.get('port')),
      username: String(form.get('username') || '').trim() || null,
      enabled: String(form.get('enabled')) === 'true',
      ...(password ? { password } : {}),
      ...(form.get('clearPassword') === 'on' ? { clearPassword: true } : {}),
    };

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const editing = Boolean(editor && editor !== 'new');
      if (editor && editor !== 'new') await api.proxies.update(editor.id, input);
      else {
        await api.proxies.create({
          name: input.name,
          host: input.host,
          port: input.port,
          username: input.username || undefined,
          password: password || undefined,
          enabled: input.enabled,
        });
      }
      setEditor(null);
      setSuccess(editing ? 'Proxy actualizado y comprobado correctamente.' : 'Proxy creado y comprobado correctamente.');
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  async function validate(item: ProxyRecord) {
    try {
      setCheckingId(item.id);
      setError(null);
      setSuccess(null);
      const updated = await api.proxies.validate(item.id);
      setItems((current) => current.map((row) => row.id === item.id ? updated : row));
      setSuccess(`Proxy ${item.name} comprobado correctamente.`);
    } catch (validationError: any) {
      setError(validationError.message);
    } finally {
      setCheckingId(null);
    }
  }

  async function remove(item: ProxyRecord) {
    if (!confirm(`¿Eliminar el proxy ${item.name}? Las asignaciones quedarán sin proxy.`)) return;
    try {
      setError(null);
      setSuccess(null);
      await api.proxies.remove(item.id);
      setSuccess('Proxy eliminado correctamente.');
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  const current = editor && editor !== 'new' ? editor : null;

  return (
    <>
      <PageHead
        title="Proxies"
        description="Cada proxy se comprueba desde el Worker. El protocolo, IP de salida, país, ciudad y zona horaria se detectan automáticamente; las contraseñas permanecen cifradas."
        actions={
          <button className="button primary" onClick={() => { setError(null); setSuccess(null); setEditor('new'); }}>
            <Plus size={14} />
            Nuevo proxy
          </button>
        }
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <Card>
        {items.length === 0 ? (
          <Empty title="No hay proxies" description="Agrega un proxy; userFLEX comprobará la conexión y detectará su tipo automáticamente." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Ubicación / salida</th>
                  <th>Tipo</th>
                  <th>Host</th>
                  <th>Puerto</th>
                  <th>Login</th>
                  <th>Contraseña</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-primary">
                        <Network size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                        {item.name}
                      </div>
                      <div className="table-secondary">
                        <Clock3 size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
                        {checkedLabel(item.last_checked_at)}
                        {item.last_latency_ms !== null ? ` · ${item.last_latency_ms} ms` : ''}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Badge tone={item.enabled ? 'ok' : 'bad'}>{item.enabled ? 'ACTIVO' : 'INACTIVO'}</Badge>
                        <Badge tone={validationTone(item.validation_status)}>{validationLabel(item.validation_status)}</Badge>
                      </div>
                      {item.validation_error && (
                        <div className="table-secondary" style={{ maxWidth: 250, marginTop: 5 }} title={item.validation_error}>
                          {item.validation_error}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="table-primary" style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                        <span style={{ fontSize: 18, lineHeight: 1 }}>{flagEmoji(item.country_code)}</span>
                        <span>{item.public_ip || '—'}</span>
                      </div>
                      <div className="table-secondary" style={{ marginTop: 4 }}>
                        <MapPin size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
                        {locationLabel(item)}
                      </div>
                      {item.timezone && <div className="table-secondary">{item.timezone}</div>}
                    </td>
                    <td>
                      <Badge tone={item.proxy_type === 'unknown' ? 'neutral' : item.browser_compatible ? 'ok' : 'warn'}>
                        {protocolLabel(item)}
                      </Badge>
                    </td>
                    <td className="mono">{item.host}</td>
                    <td className="mono">{item.port}</td>
                    <td>{item.username || '—'}</td>
                    <td>
                      {item.has_password ? (
                        <Badge tone="ok"><KeyRound size={10} />Cifrada</Badge>
                      ) : (
                        <Badge>Sin clave</Badge>
                      )}
                    </td>
                    <td>
                      <div className="toolbar" style={{ margin: 0, minWidth: 245 }}>
                        <button className="button secondary small" disabled={checkingId === item.id} onClick={() => void validate(item)}>
                          <RefreshCw size={12} className={checkingId === item.id ? 'spin' : ''} />
                          {checkingId === item.id ? 'Comprobando…' : 'Comprobar'}
                        </button>
                        <button className="button secondary small" onClick={() => { setError(null); setSuccess(null); setEditor(item); }}>
                          <Pencil size={12} />
                          Editar
                        </button>
                        <button className="button danger small" onClick={() => void remove(item)}>
                          <Trash2 size={12} />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editor && (
        <Modal
          title={current ? `Editar proxy · ${current.name}` : 'Nuevo proxy'}
          error={error}
          onClose={() => !saving && setEditor(null)}
          actions={
            <>
              <button className="button secondary" disabled={saving} onClick={() => setEditor(null)}>Cancelar</button>
              <button className="button primary" form="proxy-form" type="submit" disabled={saving}>
                {saving ? <><RefreshCw size={14} className="spin" />Comprobando conexión…</> : 'Guardar y comprobar'}
              </button>
            </>
          }
        >
          <form id="proxy-form" onSubmit={submit} className="form-grid">
            <Field label="Nombre" className="span-2">
              <input className="input" name="name" defaultValue={current?.name || ''} required maxLength={100} />
            </Field>
            <Field label="Host" help="IP o dominio del servidor proxy, sin http:// ni socks5://.">
              <input className="input" name="host" defaultValue={current?.host || ''} required maxLength={255} autoComplete="off" />
            </Field>
            <Field label="Puerto" help="El tipo se detecta automáticamente; no tienes que elegir HTTP, SOCKS o SSH.">
              <input className="input" name="port" type="number" min="1" max="65535" defaultValue={current?.port || ''} required />
            </Field>
            <Field label="Usuario">
              <input className="input" name="username" defaultValue={current?.username || ''} autoComplete="off" />
            </Field>
            <Field
              label={current?.has_password ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              help={current?.has_password ? 'Déjala vacía para conservar la clave cifrada actual.' : 'Se usa para comprobar el proxy y después se almacena cifrada.'}
            >
              <input className="input" name="password" type="password" autoComplete="new-password" />
            </Field>
            <Field label="Estado">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
            {current?.has_password && (
              <Field label="Clave guardada">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" name="clearPassword" />
                  Eliminar contraseña almacenada
                </label>
              </Field>
            )}
            <div className="span-2" style={{ padding: '12px 14px', border: '1px solid #dbe3ef', borderRadius: 12, background: '#f8fafc', fontSize: 12, lineHeight: 1.55, color: '#64748b' }}>
              Al guardar, userFLEX intenta detectar automáticamente HTTP, HTTPS, SOCKS4, SOCKS5 o SSH. Para proxies públicos también comprueba una salida real a Internet y obtiene IP, país, ciudad y zona horaria. Las IP privadas (por ejemplo 192.168.x.x) no pueden comprobarse desde Cloudflare y aparecerán como “No verificable”.
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
