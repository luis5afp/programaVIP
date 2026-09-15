import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarClock, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Client, Plan } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function endDate(days = 30) {
  return dateInput(new Date(Date.now() + days * 86400000));
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

export function ClientsView() {
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [credentialsClient, setCredentialsClient] = useState<Client | null>(null);
  const [subscriptionClient, setSubscriptionClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const defaultStart = useMemo(() => dateInput(new Date()), []);

  async function load() {
    try {
      const [clientRows, planRows] = await Promise.all([api.clients.list(), api.plans.list()]);
      setClients(clientRows);
      setPlans(planRows);
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.clients.create({
        name: String(form.get('name') || '').trim(),
        email: String(form.get('email') || '').trim(),
        phone: String(form.get('phone') || '').trim(),
        planId: String(form.get('planId') || ''),
        startsAt: new Date(`${String(form.get('startsAt'))}T00:00:00Z`).toISOString(),
        expiresAt: new Date(`${String(form.get('expiresAt'))}T23:59:59Z`).toISOString(),
        username: String(form.get('username') || '').trim(),
        password: String(form.get('password') || ''),
      });
      setCreateOpen(false);
      await load();
    } catch (createError: any) {
      setError(createError.message);
    }
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editClient) return;
    const form = new FormData(event.currentTarget);
    try {
      await api.clients.update(editClient.id, {
        name: String(form.get('name') || '').trim(),
        email: String(form.get('email') || '').trim(),
        phone: String(form.get('phone') || '').trim() || null,
        status: String(form.get('status')) as Client['status'],
        allow_external_browsing: form.get('allowExternalBrowsing') === 'on',
      });
      setEditClient(null);
      await load();
    } catch (saveError: any) {
      setError(saveError.message);
    }
  }

  async function resetCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credentialsClient) return;
    const form = new FormData(event.currentTarget);
    try {
      await api.clients.credentials(
        credentialsClient.id,
        String(form.get('username') || '').trim(),
        String(form.get('password') || ''),
      );
      setCredentialsClient(null);
      await load();
    } catch (credentialsError: any) {
      setError(credentialsError.message);
    }
  }

  async function renew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subscriptionClient) return;
    const form = new FormData(event.currentTarget);
    try {
      await api.clients.subscription(subscriptionClient.id, {
        planId: String(form.get('planId')),
        startsAt: new Date(`${String(form.get('startsAt'))}T00:00:00Z`).toISOString(),
        expiresAt: new Date(`${String(form.get('expiresAt'))}T23:59:59Z`).toISOString(),
      });
      setSubscriptionClient(null);
      await load();
    } catch (renewError: any) {
      setError(renewError.message);
    }
  }

  async function toggle(client: Client) {
    try {
      await api.clients.update(client.id, {
        status: client.status === 'active' ? 'suspended' : 'active',
      });
      await load();
    } catch (toggleError: any) {
      setError(toggleError.message);
    }
  }

  async function remove(client: Client) {
    if (!confirm(`¿Eliminar definitivamente a ${client.name}?`)) return;
    try {
      await api.clients.remove(client.id);
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  const normalizedSearch = normalizeSearchValue(searchQuery.trim());
  const filteredClients = normalizedSearch
    ? clients.filter((client) => {
        const searchable = [
          client.name,
          client.email,
          client.phone || '',
          client.credential?.username || '',
          client.subscription?.plan?.name || '',
          client.status,
        ].join(' ');
        return normalizeSearchValue(searchable).includes(normalizedSearch);
      })
    : clients;

  return (
    <>
      <PageHead
        title="Clientes"
        description="Clientes reales con credenciales de PC hasheadas, suscripción y suspensión controladas por el servidor."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, color: '#94a3b8', pointerEvents: 'none' }} />
              <input
                className="input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar clientes..."
                aria-label="Buscar clientes"
                autoComplete="off"
                style={{ width: 270, paddingLeft: 34 }}
              />
            </label>
            <button className="button primary" onClick={() => setCreateOpen(true)} disabled={plans.length === 0}>
              <Plus size={14} />
              Nuevo cliente
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} />
      {plans.length === 0 && (
        <div className="error-banner">
          Primero crea al menos un plan. Un cliente sin suscripción no puede autenticarse en userFLEX Client.
        </div>
      )}

      <Card>
        {clients.length === 0 ? (
          <Empty title="No hay clientes" description="Crea el primer cliente cuando tengas un plan definido." />
        ) : filteredClients.length === 0 ? (
          <Empty title="No se encontraron clientes" description={`No hay coincidencias para “${searchQuery.trim()}”. Prueba con otra parte del nombre, correo o usuario.`} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Login PC</th>
                  <th>Plan / vencimiento</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => {
                  const expired = client.subscription
                    ? new Date(client.subscription.expires_at).getTime() <= Date.now()
                    : true;
                  return (
                    <tr key={client.id}>
                      <td>
                        <div className="table-primary">{client.name}</div>
                        <div className="table-secondary">
                          {client.email}{client.phone ? ` · ${client.phone}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="table-primary mono">{client.credential?.username || 'Sin credenciales'}</div>
                        <div className="table-secondary">
                          {client.credential?.has_password ? 'Contraseña configurada' : 'Sin contraseña'}
                        </div>
                      </td>
                      <td>
                        {client.subscription ? (
                          <>
                            <div className="table-primary">{client.subscription.plan?.name || 'Plan'}</div>
                            <div className="table-secondary">
                              vence {new Date(client.subscription.expires_at).toLocaleDateString()}
                            </div>
                          </>
                        ) : (
                          <Badge tone="bad">Sin plan</Badge>
                        )}
                      </td>
                      <td>
                        <Badge tone={client.status === 'active' && !expired ? 'ok' : 'bad'}>
                          {client.status === 'suspended' ? 'Suspendido' : expired ? 'Vencido' : 'Activo'}
                        </Badge>
                      </td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          <button className="button secondary small" onClick={() => setEditClient(client)}>
                            <Pencil size={12} />
                            Editar
                          </button>
                          <button className="button secondary small" onClick={() => setCredentialsClient(client)}>
                            <KeyRound size={12} />
                            Credenciales
                          </button>
                          <button className="button secondary small" onClick={() => setSubscriptionClient(client)}>
                            <CalendarClock size={12} />
                            Plan
                          </button>
                          <button className="button secondary small" onClick={() => void toggle(client)}>
                            {client.status === 'active' ? 'Suspender' : 'Activar'}
                          </button>
                          <button className="button danger small" onClick={() => void remove(client)}>
                            <Trash2 size={12} />
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

      {createOpen && (
        <Modal
          title="Nuevo cliente"
          onClose={() => setCreateOpen(false)}
          actions={
            <>
              <button className="button secondary" onClick={() => setCreateOpen(false)}>Cancelar</button>
              <button className="button primary" form="client-form" type="submit">Crear cliente</button>
            </>
          }
        >
          <form id="client-form" onSubmit={create} className="form-grid">
            <Field label="Nombre"><input className="input" name="name" required maxLength={120} /></Field>
            <Field label="Correo"><input className="input" name="email" type="email" required /></Field>
            <Field label="Teléfono"><input className="input" name="phone" maxLength={40} /></Field>
            <Field label="Plan">
              <select className="select" name="planId" required>
                {plans.filter((plan) => plan.enabled).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </Field>
            <Field label="Inicio"><input className="input" name="startsAt" type="date" defaultValue={defaultStart} required /></Field>
            <Field label="Vencimiento"><input className="input" name="expiresAt" type="date" defaultValue={endDate()} required /></Field>
            <Field label="Usuario para PC"><input className="input" name="username" required minLength={3} maxLength={80} autoComplete="off" /></Field>
            <Field label="Contraseña para PC" help="Mínimo 6 caracteres; nunca se vuelve a mostrar."><input className="input" name="password" type="password" required minLength={6} autoComplete="new-password" /></Field>
          </form>
        </Modal>
      )}

      {editClient && (
        <Modal
          title={`Editar cliente · ${editClient.name}`}
          onClose={() => setEditClient(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setEditClient(null)}>Cancelar</button>
              <button className="button primary" form="edit-client-form" type="submit">Guardar</button>
            </>
          }
        >
          <form id="edit-client-form" onSubmit={saveClient} className="form-grid">
            <Field label="Nombre"><input className="input" name="name" defaultValue={editClient.name} required maxLength={120} /></Field>
            <Field label="Correo"><input className="input" name="email" type="email" defaultValue={editClient.email} required /></Field>
            <Field label="Teléfono"><input className="input" name="phone" defaultValue={editClient.phone || ''} maxLength={40} /></Field>
            <Field label="Estado">
              <select className="select" name="status" defaultValue={editClient.status}>
                <option value="active">Activo</option>
                <option value="suspended">Suspendido</option>
              </select>
            </Field>
            <Field label="Navegación adicional" className="span-2" help="Habilita la opción “Abrir Google” al mantener el cursor sobre + dentro de un perfil. La pestaña seguirá aislada dentro de ese mismo perfil.">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, cursor: 'pointer' }}>
                <input type="checkbox" name="allowExternalBrowsing" defaultChecked={editClient.allow_external_browsing === true} />
                <span>Permitir navegación web (Google) para este cliente</span>
              </label>
            </Field>
          </form>
        </Modal>
      )}

      {credentialsClient && (
        <Modal
          title={`Cambiar credenciales · ${credentialsClient.name}`}
          onClose={() => setCredentialsClient(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setCredentialsClient(null)}>Cancelar</button>
              <button className="button primary" form="credentials-form" type="submit">Guardar</button>
            </>
          }
        >
          <form id="credentials-form" onSubmit={resetCredentials} className="form-grid">
            <Field label="Usuario" className="span-2"><input className="input" name="username" defaultValue={credentialsClient.credential?.username || ''} required minLength={3} autoComplete="off" /></Field>
            <Field label="Nueva contraseña" className="span-2" help="Al cambiarla se revocan las sesiones activas del Client."><input className="input" name="password" type="password" required minLength={6} autoComplete="new-password" /></Field>
          </form>
        </Modal>
      )}

      {subscriptionClient && (
        <Modal
          title={`Renovar plan · ${subscriptionClient.name}`}
          onClose={() => setSubscriptionClient(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setSubscriptionClient(null)}>Cancelar</button>
              <button className="button primary" form="subscription-form" type="submit">Guardar</button>
            </>
          }
        >
          <form id="subscription-form" onSubmit={renew} className="form-grid">
            <Field label="Plan" className="span-2">
              <select className="select" name="planId" defaultValue={subscriptionClient.subscription?.plan_id || plans.find((plan) => plan.enabled)?.id} required>
                {plans.filter((plan) => plan.enabled).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </Field>
            <Field label="Inicio"><input className="input" name="startsAt" type="date" defaultValue={defaultStart} required /></Field>
            <Field label="Vencimiento"><input className="input" name="expiresAt" type="date" defaultValue={endDate()} required /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}
