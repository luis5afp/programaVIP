import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Plan } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Plan | 'new' | null;

export function PlansView() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setPlans(await api.plans.list());
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
    const durationRaw = String(form.get('durationDays') || '').trim();
    const input = {
      name: String(form.get('name') || '').trim(),
      duration_days: durationRaw ? Number(durationRaw) : null,
      max_devices: Number(form.get('maxDevices') || 1),
      max_profiles: Number(form.get('maxProfiles') || 1),
      enabled: String(form.get('enabled')) === 'true',
    };

    try {
      if (editor && editor !== 'new') await api.plans.update(editor.id, input);
      else await api.plans.create(input);
      setEditor(null);
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

  const current = editor && editor !== 'new' ? editor : null;

  return (
    <>
      <PageHead
        title="Planes"
        description="Define duración y límites que el servidor aplica a las suscripciones del Client."
        actions={
          <button className="button primary" onClick={() => setEditor('new')}>
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
                  <th>Perfiles</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="table-primary">{plan.name}</td>
                    <td>{plan.duration_days === null ? 'Sin límite definido' : `${plan.duration_days} días`}</td>
                    <td>{plan.max_devices}</td>
                    <td>{plan.max_profiles}</td>
                    <td>
                      <Badge tone={plan.enabled ? 'ok' : 'bad'}>{plan.enabled ? 'Activo' : 'Inactivo'}</Badge>
                    </td>
                    <td>
                      <div className="toolbar" style={{ margin: 0 }}>
                        <button className="button secondary small" onClick={() => setEditor(plan)}>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editor && (
        <Modal
          title={current ? `Editar plan · ${current.name}` : 'Nuevo plan'}
          onClose={() => setEditor(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setEditor(null)}>Cancelar</button>
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
            <Field label="Máximo de perfiles">
              <input className="input" name="maxProfiles" type="number" min="1" max="500" defaultValue={current?.max_profiles ?? 5} required />
            </Field>
            <Field label="Estado">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}
