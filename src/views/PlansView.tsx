import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Plan, Profile } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Plan | 'new' | null;

function profileLabel(profile: Profile) {
  return profile.tags?.[0] || profile.name;
}

export function PlansView() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [planRows, profileRows] = await Promise.all([
        api.plans.list(),
        api.profiles.list(),
      ]);
      setPlans(planRows);
      setProfiles(profileRows);
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openEditor(next: Exclude<Editor, null>) {
    setEditor(next);
    setSelectedProfileIds(next === 'new' ? [] : [...(next.profile_ids || [])]);
  }

  function closeEditor() {
    setEditor(null);
    setSelectedProfileIds([]);
  }

  function toggleProfile(profileId: string) {
    setSelectedProfileIds((current) => current.includes(profileId)
      ? current.filter((id) => id !== profileId)
      : [...current, profileId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedProfileIds.length === 0) {
      setError('Selecciona al menos un perfil incluido en este plan.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const durationRaw = String(form.get('durationDays') || '').trim();
    const input = {
      name: String(form.get('name') || '').trim(),
      duration_days: durationRaw ? Number(durationRaw) : null,
      max_devices: Number(form.get('maxDevices') || 1),
      max_profiles: selectedProfileIds.length,
      profile_ids: selectedProfileIds,
      enabled: String(form.get('enabled')) === 'true',
    };

    try {
      if (editor && editor !== 'new') await api.plans.update(editor.id, input);
      else await api.plans.create(input);
      closeEditor();
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    }
  }

  async function remove(plan: Plan) {
    if (!confirm(`¿Eliminar el plan ${plan.name}?`)) return;
    try {
      await api.plans.remove(plan.id);
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  function allowedProfileNames(plan: Plan) {
    return plan.profile_ids
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter(Boolean)
      .map((profile) => profileLabel(profile!));
  }

  const current = editor && editor !== 'new' ? editor : null;

  return (
    <>
      <PageHead
        title="Planes"
        description="Define duración, dispositivos y exactamente qué perfiles/webs incluye cada plan."
        actions={
          <button className="button primary" onClick={() => openEditor('new')} disabled={profiles.length === 0}>
            <Plus size={14} />
            Nuevo plan
          </button>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {plans.length === 0 ? (
          <Empty title="No hay planes" description="Crea el primer plan para poder habilitar clientes." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Duración</th>
                  <th>Dispositivos</th>
                  <th>Perfiles incluidos</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const names = allowedProfileNames(plan);
                  return (
                    <tr key={plan.id}>
                      <td className="table-primary">{plan.name}</td>
                      <td>{plan.duration_days === null ? 'Sin límite definido' : `${plan.duration_days} días`}</td>
                      <td>{plan.max_devices}</td>
                      <td>
                        <div className="table-primary">{plan.profile_ids.length} perfiles</div>
                        <div className="table-secondary">
                          {names.length > 0
                            ? `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` · +${names.length - 3}` : ''}`
                            : 'Sin perfiles'}
                        </div>
                      </td>
                      <td>
                        <Badge tone={plan.enabled ? 'ok' : 'bad'}>{plan.enabled ? 'Activo' : 'Inactivo'}</Badge>
                      </td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          <button className="button secondary small" onClick={() => openEditor(plan)}>
                            <Pencil size={12} />
                            Editar
                          </button>
                          <button className="button danger small" onClick={() => void remove(plan)}>
                            <Trash2 size={12} />
                            Eliminar
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
          title={current ? `Editar plan · ${current.name}` : 'Nuevo plan'}
          onClose={closeEditor}
          actions={
            <>
              <button className="button secondary" onClick={closeEditor}>Cancelar</button>
              <button className="button primary" form="plan-form" type="submit">Guardar</button>
            </>
          }
        >
          <form id="plan-form" onSubmit={submit} className="form-grid">
            <Field label="Nombre" className="span-2">
              <input className="input" name="name" defaultValue={current?.name || ''} required maxLength={80} />
            </Field>
            <Field label="Duración (días)" help="Déjalo vacío si la fecha se definirá solo por suscripción.">
              <input className="input" name="durationDays" type="number" min="1" max="3650" defaultValue={current?.duration_days ?? 30} />
            </Field>
            <Field label="Máximo de dispositivos">
              <input className="input" name="maxDevices" type="number" min="1" max="50" defaultValue={current?.max_devices ?? 1} required />
            </Field>
            <Field label="Estado" className="span-2">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
            <Field
              label={`Perfiles incluidos (${selectedProfileIds.length})`}
              help="Los clientes de este plan sólo podrán recibir perfiles seleccionados aquí. La cantidad del plan se calcula automáticamente según esta selección."
              className="span-2"
            >
              <div style={{ border: '1px solid #dbe2ea', borderRadius: 12, padding: 12 }}>
                <div className="toolbar" style={{ margin: '0 0 10px' }}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setSelectedProfileIds(profiles.map((profile) => profile.id))}
                  >
                    Seleccionar todos
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setSelectedProfileIds([])}
                  >
                    Ninguno
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                  {profiles.map((profile) => (
                    <label
                      key={profile.id}
                      style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', border: '1px solid #e5eaf0', borderRadius: 10, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProfileIds.includes(profile.id)}
                        onChange={() => toggleProfile(profile.id)}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="table-primary">{profileLabel(profile)}</span>
                        <span className="table-secondary" style={{ display: 'block' }}>
                          {profile.enabled ? new URL(profile.url).hostname : 'Inactivo'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}
