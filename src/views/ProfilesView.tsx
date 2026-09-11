import { ClipboardEvent, DragEvent, FormEvent, useEffect, useState } from 'react';
import { Globe2, ImagePlus, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import type { Profile, ProfileProxyDefault, ProxyRecord } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Profile | 'new' | null;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function profileLabel(profile: Profile) {
  return profile.tags?.[0] || profile.name;
}

export function ProfilesView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [proxyDefaults, setProxyDefaults] = useState<ProfileProxyDefault[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [profileRows, proxyRows, defaultRows] = await Promise.all([
        api.profiles.list(),
        api.proxies.list(),
        api.profileProxyDefaults.list(),
      ]);
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

  useEffect(() => {
    return () => {
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    };
  }, [imageObjectUrl]);

  function replaceObjectUrl(next: string | null) {
    setImageObjectUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
  }

  function openEditor(value: Exclude<Editor, null>) {
    const current = value === 'new' ? null : value;
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl(current?.image_url || '');
    setEditor(value);
    setError(null);
  }

  function closeEditor() {
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl('');
    setEditor(null);
  }

  function chooseImage(file: File | null) {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      setError('Formato no permitido. Usa JPG, PNG, WebP o GIF.');
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      setError('La imagen no puede superar 5 MB.');
      return;
    }
    setError(null);
    setImageFile(file);
    replaceObjectUrl(URL.createObjectURL(file));
  }

  function pasteImage(event: ClipboardEvent<HTMLDivElement>) {
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          chooseImage(file);
          return;
        }
      }
    }
  }

  function dropImage(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.startsWith('image/')) || null;
    chooseImage(file);
  }

  function changeImageUrl(value: string) {
    setImageUrl(value);
    if (imageFile) {
      setImageFile(null);
      replaceObjectUrl(null);
    }
  }

  function defaultProxyId(profileId: string) {
    return proxyDefaults.find((item) => item.profile_id === profileId)?.proxy_id || null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get('label') || '').trim();
    const proxyId = String(form.get('proxyId') || '') || null;

    try {
      setSaving(true);
      setError(null);
      let finalImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        const uploaded = await api.profiles.uploadImage(imageFile);
        finalImageUrl = uploaded.url;
      }

      const input = {
        name: label,
        url: String(form.get('url') || '').trim(),
        platform: null,
        image_url: finalImageUrl,
        tags: [label],
        enabled: String(form.get('enabled')) === 'true',
        session_mode: String(form.get('sessionMode')) as Profile['session_mode'],
      };

      const savedProfile = editor && editor !== 'new'
        ? await api.profiles.update(editor.id, input)
        : await api.profiles.create(input);

      await api.profileProxyDefaults.set(savedProfile.id, proxyId);
      closeEditor();
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(profile: Profile) {
    if (!confirm(`¿Eliminar el perfil ${profileLabel(profile)}?`)) return;
    try {
      await api.profiles.remove(profile.id);
      await load();
    } catch (removeError: any) {
      setError(removeError.message);
    }
  }

  const current = editor && editor !== 'new' ? editor : null;
  const previewUrl = imageObjectUrl || imageUrl.trim() || null;
  const currentProxyId = current ? defaultProxyId(current.id) : null;

  return (
    <>
      <PageHead
        title="Perfiles / Webs"
        description="Catálogo administrado de sitios asignables a clientes. Cada perfil usa una etiqueta visible y puede tener un proxy predeterminado opcional."
        actions={
          <button className="button primary" onClick={() => openEditor('new')}>
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
          {profiles.map((profile) => {
            const selectedProxy = proxies.find((proxy) => proxy.id === defaultProxyId(profile.id));
            return (
              <Card className="profile-card" key={profile.id}>
                <div className="profile-image">
                  {profile.image_url ? (
                    <img src={profile.image_url} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <Globe2 size={28} />
                  )}
                </div>
                <div className="profile-body">
                  <h3>{profileLabel(profile)}</h3>
                  <a className="profile-url" href={profile.url} target="_blank" rel="noreferrer">{profile.url}</a>
                  <div className="profile-tags">
                    {selectedProxy ? (
                      <Badge tone={selectedProxy.enabled ? 'neutral' : 'warn'}>
                        Proxy: {selectedProxy.name}{selectedProxy.enabled ? '' : ' · inactivo'}
                      </Badge>
                    ) : (
                      <Badge>Conexión directa</Badge>
                    )}
                  </div>
                  <div className="profile-actions">
                    <Badge tone={profile.enabled ? 'ok' : 'bad'}>{profile.enabled ? 'Activo' : 'Inactivo'}</Badge>
                    <div className="toolbar" style={{ margin: 0 }}>
                      <button className="button secondary small" onClick={() => openEditor(profile)}>
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
            );
          })}
        </div>
      )}

      {editor && (
        <Modal
          title={current ? `Editar perfil · ${profileLabel(current)}` : 'Nuevo perfil / web'}
          onClose={closeEditor}
          actions={
            <>
              <button className="button secondary" onClick={closeEditor} disabled={saving}>Cancelar</button>
              <button className="button primary" form="profile-form" type="submit" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="profile-form" onSubmit={submit} className="form-grid">
            <Field label="Etiqueta" className="span-2" help="Nombre visible del perfil, por ejemplo: chatgpt #1">
              <input
                className="input"
                name="label"
                defaultValue={current ? profileLabel(current) : ''}
                required
                maxLength={100}
                placeholder="chatgpt #1"
              />
            </Field>
            <Field label="URL HTTPS" className="span-2">
              <input className="input" name="url" type="url" defaultValue={current?.url || ''} required placeholder="https://..." />
            </Field>

            <div className="span-2 field">
              <label>Imagen del perfil</label>
              <div
                tabIndex={0}
                onPaste={pasteImage}
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropImage}
                style={{
                  border: '1px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: '#f8fafc',
                  outline: 'none',
                }}
              >
                <div
                  style={{
                    width: 118,
                    height: 78,
                    flex: '0 0 auto',
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#94a3b8',
                  }}
                >
                  {previewUrl ? (
                    <img src={previewUrl} alt="Vista previa" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <ImagePlus size={26} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                    Subir, arrastrar o pegar una imagen
                  </div>
                  <div className="help" style={{ marginBottom: 9 }}>
                    JPG/JPEG, PNG, WebP o GIF · máximo 5 MB · también puedes copiar una imagen y presionar Ctrl+V aquí.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <label className="button secondary small" style={{ cursor: 'pointer' }}>
                      <Upload size={12} />
                      Elegir imagen
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                        hidden
                        onChange={(event) => {
                          chooseImage(event.currentTarget.files?.[0] || null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {imageFile && <span className="help">{imageFile.name || 'Imagen pegada'} · {(imageFile.size / 1024).toFixed(0)} KB</span>}
                  </div>
                </div>
              </div>
            </div>

            <Field label="O usar imagen por URL HTTPS" className="span-2" help="Opcional. Si subes o pegas una imagen, se guardará automáticamente y esta URL será reemplazada.">
              <input
                className="input"
                name="imageUrl"
                type="url"
                value={imageUrl}
                onChange={(event) => changeImageUrl(event.target.value)}
                placeholder="https://.../imagen.jpg"
              />
            </Field>

            <Field label="Proxy (opcional)" className="span-2" help="Se usará por defecto. Si una asignación tiene otro proxy, el proxy de la asignación tendrá prioridad.">
              <select className="select" name="proxyId" defaultValue={currentProxyId || ''}>
                <option value="">Sin proxy · conexión directa</option>
                {proxies.map((proxy) => (
                  <option value={proxy.id} key={proxy.id}>
                    {proxy.name} · {proxy.host}:{proxy.port}{proxy.enabled ? '' : ' · inactivo'}
                  </option>
                ))}
              </select>
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
