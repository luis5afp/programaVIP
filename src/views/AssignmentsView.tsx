import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Assignment, Client, Plan, Profile, ProfileProxyDefault, ProxyRecord } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Assignment | 'new' | null;

function profileLabel(profile: Profile) {
  return profile.tags?.[0] || profile.name;
}

export function AssignmentsView() {
  const [items, setItems] = useState<Assignment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [proxyDefaults, setProxyDefaults] = useState<ProfileProxyDefault[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [draftClientId, setDraftClientId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [assignmentRows, clientRows, planRows, profileRows, proxyRows, defaultRows] = await Promise.all([
        api.assignments.list(),
        api.clients.list(),
        api.plans.list(),
        api.profiles.list(),
        api.proxies.list(),
        api.profileProxyDefaults.list(),
      ]);
      setItems(assignmentRows);
      setClients(clientRows);
      setPlans(planRows);
      setProfiles(profileRows);
      setProxies(proxyRows);
      setProxyDefaults(defaultRows);
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function profilesAllowedForClient(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    const planId = client?.subscription?.plan_id;
    if (!planId) return [];
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return [];
    return profiles.filter((profile) => profile.enabled && plan.profile_ids.includes(profile.id));
  }

  function startCreate() {
    const firstEligible = clients.find((client) => profilesAllowedForClient(client.id).length > 0);
    setDraftClientId(firstEligible?.id || clients[0]?.id || '');
    setEditor('new');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const proxyId = String(form.get('proxyId') || '') || null;
    const enabled = String(form.get('enabled')) === 'true';

    try {
      if (editor && editor !== 'new') {
        await api.assignments.update(editor.id, { proxyId, enabled });
      } else {
        await api.assignments.create({
          clientId: String(form.get('clientId') || ''),
          profileId: String(form.get('profileId') || ''),
          proxyId,
          enabled,
        });
      }
      setEditor(null);
      setDraftClientId('');
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    }
  }

  async function remove(item: Assignment) {
    if (!confirm('¿Quitar esta asignación?')) return;
    try {
      await api.assignments.remove(item.id);
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  function defaultProxy(profileId: string) {
    const proxyId = proxyDefaults.find((item) => item.profile_id === profileId)?.proxy_id;
    return proxyId ? proxies.find((proxy) => proxy.id === proxyId) || null : null;
  }

  const eligibleClients = clients.filter((client) => profilesAllowedForClient(client.id).length > 0);
  const canCreate = eligibleClients.length > 0;
  const current = editor && editor !== 'new' ? editor : null;
  const currentClientId = current?.client_id || draftClientId;
  const allowedProfiles = current
    ? profiles.filter((profile) => profile.id === current.profile_id)
    : profilesAllowedForClient(currentClientId);
  const currentClient = clients.find((client) => client.id === currentClientId);
  const currentPlan = plans.find((plan) => plan.id === currentClient?.subscription?.plan_id);

  return (
    <>
      <PageHead
        title="Asignaciones"
        description="Relaciona Cliente → Perfil/Web. Sólo aparecen perfiles permitidos por el plan activo del cliente."
        actions={
          <button className="button primary" onClick={startCreate} disabled={!canCreate}>
            <Plus size={14} />
            Nueva asignación
          </button>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {items.length === 0 ? (
          <Empty title="No hay asignaciones" description="Crea un cliente y un perfil permitido por su plan para empezar a entregar accesos." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Perfil</th>
                  <th>Proxy efectivo</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const inheritedProxy = item.proxy ? null : defaultProxy(item.profile_id);
                  const effectiveProxy = item.proxy || inheritedProxy;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="table-primary">{item.client?.name || item.client_id}</div>
                        <div className="table-secondary">{item.client?.email}</div>
                      </td>
                      <td>
                        <div className="table-primary">
                          {profiles.find((profile) => profile.id === item.profile_id)
                            ? profileLabel(profiles.find((profile) => profile.id === item.profile_id)!)
                            : item.profile?.name || item.profile_id}
                        </div>
                        <div className="table-secondary">{item.profile?.url}</div>
                      </td>
                      <td>
                        {effectiveProxy ? (
                          <>
                            <div className="table-primary">{effectiveProxy.name}</div>
                            <div className="table-secondary mono">
                              {effectiveProxy.host}:{effectiveProxy.port} · {item.proxy ? 'asignación' : 'perfil'}
                            </div>
                          </>
                        ) : (
                          <Badge>Directo</Badge>
                        )}
                      </td>
                      <td><Badge tone={item.enabled ? 'ok' : 'bad'}>{item.enabled ? 'Activa' : 'Inactiva'}</Badge></td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          <button className="button secondary small" onClick={() => setEditor(item)}>
                            <Pencil size={12} />
                            Editar
                          </button>
                          <button className="button danger small" onClick={() => void remove(item)}>
                            <Trash2 size={12} />
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editor && (
        <Modal
          title={current ? 'Editar asignación' : 'Nueva asignación'}
          onClose={() => {
            setEditor(null);
            setDraftClientId('');
          }}
          actions={
            <>
              <button className="button secondary" onClick={() => {
                setEditor(null);
                setDraftClientId('');
              }}>Cancelar</button>
              <button className="button primary" form="assignment-form" type="submit" disabled={!current && allowedProfiles.length === 0}>Guardar</button>
            </>
          }
        >
          <form id="assignment-form" className="form-grid" onSubmit={submit}>
            <Field label="Cliente" className="span-2">
              <select
                className="select"
                name="clientId"
                required
                disabled={Boolean(current)}
                value={currentClientId}
                onChange={(event) => setDraftClientId(event.target.value)}
              >
                {(current ? clients : eligibleClients).map((client) => (
                  <option value={client.id} key={client.id}>{client.name} · {client.email}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Perfil / Web"
              className="span-2"
              help={currentPlan ? `Permitidos por el plan ${currentPlan.name}.` : 'El cliente necesita un plan activo con perfiles permitidos.'}
            >
              <select className="select" name="profileId" required disabled={Boolean(current) || allowedProfiles.length === 0} defaultValue={current?.profile_id || allowedProfiles[0]?.id || ''} key={`${currentClientId}:${current?.profile_id || 'new'}`}>
                {allowedProfiles.length === 0 ? (
                  <option value="">No hay perfiles permitidos</option>
                ) : allowedProfiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>{profileLabel(profile)}</option>
                ))}
              </select>
            </Field>
            <Field label="Proxy de la asignación" help="Opcional. Vacío = usar el proxy del perfil; si el perfil tampoco tiene proxy, la conexión será directa.">
              <select className="select" name="proxyId" defaultValue={current?.proxy_id || ''}>
                <option value="">Usar configuración del perfil</option>
                {proxies.filter((proxy) => proxy.enabled).map((proxy) => (
                  <option value={proxy.id} key={proxy.id}>{proxy.name} · {proxy.host}:{proxy.port}</option>
                ))}
              </select>
            </Field>
            <Field label="Estado">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}
