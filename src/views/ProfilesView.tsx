import { FormEvent, useEffect, useState } from 'react';
import { Globe2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Profile } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Profile | 'new' | null;

export function ProfilesView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setProfiles(await api.profiles.list());
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
    const tags = String(form.get('tags') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);

    const input = {
      name: String(form.get('name') || '').trim(),
      url: String(form.get('url') || '').trim(),
      platform: String(form.get('platform') || '').trim() || null,
      image_url: String(form.get('imageUrl') || '').trim() || null,
      tags,
      enabled: String(form.get('enabled')) === 'true',
      session_mode: String(form.get('sessionMode')) as Profile['session_mode'],
    };

    try {
      if (editor && editor !== 'new') await api.profiles.update(editor.id, input);
      else await api.profiles.create(input);
      setEditor(null);
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    }
  }

  async function remove(profile: Profile) {
    if (!confirm(`¿Eliminar el perfil ${profile.name}?`)) return;
    try {
      await api.profiles.remove(profile.id);
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  const current = editor && editor !== 'new' ? editor : null;

  return (
    <>
      <PageHead
        title="Perfiles / Webs"
        description="Catálogo administrado de sitios asignables a clientes. El panel nunca muestra secretos de sesión."
        actions={
          <button className="button primary" onClick={() => setEditor('new')}>
            <Plus size={14} />
            Nuevo perfil
          </button>
        }
      />
      <ErrorBanner message={error} />

      {profiles.length === 0 ? (
        <Card>
          <Empty title="No hay perfiles" description="Agrega la primera web o perfil que quieras administrar." />
        </Card>
      ) : (
        <div className="grid three">
          {profiles.map((profile) => (
            <Card className="profile-card" key={profile.id}>
              <div className="profile-image">
                {profile.image_url ? (
                  <img src={profile.image_url} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <Globe2 size={28} />
                )}
              </div>
              <div className="profile-body">
                <h3>{profile.name}</h3>
                <a className="profile-url" href={profile.url} target="_blank" rel="noreferrer">{profile.url}</a>
                <div className="profile-tags">
                  {profile.platform && <Badge>{profile.platform}</Badge>}
                  {profile.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                </div>
                <div className="profile-actions">
                  <Badge tone={profile.enabled ? 'ok' : 'bad'}>{profile.enabled ? 'Activo' : 'Inactivo'}</Badge>
                  <div className="toolbar" style={{ margin: 0 }}>
                    <button className="button secondary small" onClick={() => setEditor(profile)}>
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button className="button danger small" onClick={() => void remove(profile)}>
                      <Trash2 size={12} />
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editor && (
        <Modal
          title={current ? `Editar perfil · ${current.name}` : 'Nuevo perfil / web'}
          onClose={() => setEditor(null)}
          actions={
            <>
              <button className="button secondary" onClick={() => setEditor(null)}>Cancelar</button>
              <button className="button primary" form="profile-form" type="submit">Guardar</button>
            </>
          }
        >
          <form id="profile-form" onSubmit={submit} className="form-grid">
            <Field label="Nombre">
              <input className="input" name="name" defaultValue={current?.name || ''} required maxLength={100} />
            </Field>
            <Field label="Plataforma">
              <input className="input" name="platform" defaultValue={current?.platform || ''} maxLength={80} placeholder="Ej. Plataforma interna" />
            </Field>
            <Field label="URL HTTPS" className="span-2">
              <input className="input" name="url" type="url" defaultValue={current?.url || ''} required placeholder="https://..." />
            </Field>
            <Field label="Imagen (URL HTTPS)" className="span-2">
              <input className="input" name="imageUrl" type="url" defaultValue={current?.image_url || ''} placeholder="https://.../imagen.png" />
            </Field>
            <Field label="Etiquetas" className="span-2" help="Separadas por coma">
              <input className="input" name="tags" defaultValue={current?.tags.join(', ') || ''} placeholder="ventas, equipo-a" />
            </Field>
            <Field label="Modo de sesión">
              <select className="select" name="sessionMode" defaultValue={current?.session_mode || 'manual-login'}>
                <option value="manual-login">Login manual en el Client</option>
                <option value="managed-first-party">Sesión administrada de dominio propio</option>
              </select>
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
