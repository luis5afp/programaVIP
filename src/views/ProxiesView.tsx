import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { ProxyRecord } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = ProxyRecord | 'new' | null;

export function ProxiesView() {
  const [items, setItems] = useState<ProxyRecord[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);

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
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    }
  }

  async function remove(item: ProxyRecord) {
    if (!confirm(`¿Eliminar el proxy ${item.name}? Las asignaciones quedarán sin proxy.`)) return;
    try {
      await api.proxies.remove(item.id);
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
        description="Inventario central. Las contraseñas se cifran en el Worker y nunca se devuelven al navegador Admin."
        actions={
          <button className="button primary" onClick={() => setEditor('new')}>
            <Plus size={14} />
            Nuevo proxy
          </button>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {items.length === 0 ? (
          <Empty title="No hay proxies" description="Agrega un proxy si algún perfil necesita una conexión administrada." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proxy</th>
                  <th>Servidor</th>
                  <th>Usuario</th>
                  <th>Clave</th>
                  <th>Estado</th>
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
                    </td>
                    <td className="mono">{item.host}:{item.port}</td>
                    <td>{item.username || '—'}</td>
                    <td>
                      {item.has_password ? (
                        <Badge tone="ok"><KeyRound size={10} />Cifrada</Badge>
                      ) : (
                        <Badge>Sin clave</Badge>
                      )}
                    </td>
                    <td><Badge tone={item.enabled ? 'ok' : 'bad'}>{item.enabled ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td>
                      <div className="toolbar" style={{ margin: 0 }}>
                        <button className="button secondary small" onClick={() => setEditor(item)}>
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
          onClose={() => setEditor(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setEditor(null)}>Cancelar</button>
              <button className="button primary" form="proxy-form" type="submit">Guardar cifrado</button>
            </>
          }
        >
          <form id="proxy-form" onSubmit={submit} className="form-grid">
            <Field label="Nombre" className="span-2">
              <input className="input" name="name" defaultValue={current?.name || ''} required maxLength={100} />
            </Field>
            <Field label="Host">
              <input className="input" name="host" defaultValue={current?.host || ''} required maxLength={255} />
            </Field>
            <Field label="Puerto">
              <input className="input" name="port" type="number" min="1" max="65535" defaultValue={current?.port || ''} required />
            </Field>
            <Field label="Usuario">
              <input className="input" name="username" defaultValue={current?.username || ''} autoComplete="off" />
            </Field>
            <Field
              label={current?.has_password ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              help={current?.has_password ? 'Déjala vacía para conservar la clave cifrada actual.' : 'Viaja por HTTPS al Worker y se almacena cifrada.'}
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
          </form>
        </Modal>
      )}
    </>
  );
}
