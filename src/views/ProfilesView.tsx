import { ClipboardEvent, DragEvent, FormEvent, useEffect, useState } from 'react';
import { Globe2, ImagePlus, KeyRound, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import type { Plan, Profile, ProfileProxyDefault, ProfileSessionState, ProxyRecord, SessionMode } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

type Editor = Profile | 'new' | null;
type CaptureLaunch = {
  profileName: string;
  launchUrl: string;
  expiresAt: string | null;
} | null;

type ProfilePlanMembership = {
  profile_id: string;
  plan_id: string;
  created_at: string;
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SESSION_MANAGER_DOWNLOAD_URL = 'https://github.com/luis5afp/programaVIP/releases/download/session-manager-v0.1.2/userFLEX-Session-Manager-0.1.2-Setup.exe';
const DEFAULT_CATEGORIES = ['Chat', 'Imagen', 'Video', 'Audio', 'Pro'];

function profileLabel(profile: Profile) {
  return profile.tags?.[0] || profile.name;
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function launchSessionManager(launchUrl: string) {
  const anchor = document.createElement('a');
  anchor.href = launchUrl;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ProfilesView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profilePlanMemberships, setProfilePlanMemberships] = useState<ProfilePlanMembership[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [proxyDefaults, setProxyDefaults] = useState<ProfileProxyDefault[]>([]);
  const [sessionStates, setSessionStates] = useState<ProfileSessionState[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [captureLaunch, setCaptureLaunch] = useState<CaptureLaunch>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>('manual-login');
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function load() {
    try {
      const [profileRows, proxyRows, defaultRows, stateRows, planRows, membershipRows] = await Promise.all([
        api.profiles.list(),
        api.proxies.list(),
        api.profileProxyDefaults.list(),
        api.profileSessions.list(),
        api.plans.list(),
        api.profilePlans.list(),
      ]);
      setProfiles(profileRows);
      setProxies(proxyRows);
      setProxyDefaults(defaultRows);
      setSessionStates(stateRows);
      setPlans(planRows);
      setProfilePlanMemberships(membershipRows);
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

  function stateFor(profileId: string) {
    return sessionStates.find((item) => item.profile_id === profileId) || null;
  }

  function planIdsFor(profileId: string) {
    return profilePlanMemberships
      .filter((item) => item.profile_id === profileId)
      .map((item) => item.plan_id);
  }

  function openEditor(value: Exclude<Editor, null>) {
    const current = value === 'new' ? null : value;
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl(current?.image_url || '');
    setSessionMode(current?.session_mode || 'manual-login');
    setSelectedPlanIds(current ? planIdsFor(current.id) : []);
    setEditor(value);
    setError(null);
  }

  function closeEditor() {
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl('');
    setSessionMode('manual-login');
    setSelectedPlanIds([]);
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

  function togglePlan(planId: string) {
    setSelectedPlanIds((current) => current.includes(planId)
      ? current.filter((id) => id !== planId)
      : [...current, planId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get('label') || '').trim();
    const proxyId = String(form.get('proxyId') || '') || null;
    const loginUsername = String(form.get('loginUsername') || '').trim();
    const loginPassword = String(form.get('loginPassword') || '');
    const currentState = editor && editor !== 'new' ? stateFor(editor.id) : null;

    try {
      setSaving(true);
      setError(null);
      if (sessionMode === 'managed-first-party') {
        if (!loginUsername) throw new Error('Ingresa el correo o usuario de la cuenta.');
        if (!currentState?.has_credentials && !loginPassword) throw new Error('Ingresa la contraseña para preparar la sesión administrada.');
      }

      let finalImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        const uploaded = await api.profiles.uploadImage(imageFile);
        finalImageUrl = uploaded.url;
      }

      const input = {
        name: label,
        url: String(form.get('url') || '').trim(),
        platform: String(form.get('category') || '').trim() || null,
        image_url: finalImageUrl,
        tags: [label],
        enabled: String(form.get('enabled')) === 'true',
        session_mode: sessionMode,
      };

      const savedProfile = editor && editor !== 'new'
        ? await api.profiles.update(editor.id, input)
        : await api.profiles.create(input);

      if (editor === 'new') setEditor(savedProfile);
      await api.profilePlans.set(savedProfile.id, selectedPlanIds);
      await api.profileProxyDefaults.set(savedProfile.id, proxyId);
      if (sessionMode === 'managed-first-party') {
        await api.profileSessions.credentials(savedProfile.id, loginUsername, loginPassword || undefined);
      }
      closeEditor();
      await load();
    } catch (submitError: any) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  async function startCapture(profile: Profile) {
    try {
      setSessionAction(profile.id);
      setError(null);
      const result = await api.profileSessions.capture(profile.id);
      setCaptureLaunch({
        profileName: profileLabel(profile),
        launchUrl: result.launch_url,
        expiresAt: result.expires_at || null,
      });
      launchSessionManager(result.launch_url);
      window.setTimeout(() => void load(), 2500);
    } catch (captureError: any) {
      setError(captureError.message);
    } finally {
      setSessionAction(null);
    }
  }

  async function clearSession(profile: Profile) {
    if (!confirm(`¿Borrar la sesión guardada de ${profileLabel(profile)}?`)) return;
    try {
      setSessionAction(profile.id);
      await api.profileSessions.clear(profile.id);
      await load();
    } catch (clearError: any) {
      setError(clearError.message);
    } finally {
      setSessionAction(null);
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
  const currentState = current ? stateFor(current.id) : null;
  const categoryOptions = Array.from(new Map(
    [...DEFAULT_CATEGORIES, ...profiles.map((profile) => profile.platform || '').filter(Boolean)]
      .map((name) => [normalizeSearchValue(String(name)), String(name).trim()]),
  ).values());
  const normalizedSearch = normalizeSearchValue(searchQuery.trim());
  const filteredProfiles = normalizedSearch
    ? profiles.filter((profile) => {
        const proxyName = proxies.find((proxy) => proxy.id === defaultProxyId(profile.id))?.name || '';
        const profilePlanIds = planIdsFor(profile.id);
        const planNames = plans.filter((plan) => profilePlanIds.includes(plan.id)).map((plan) => plan.name);
        const searchable = [profileLabel(profile), profile.name, profile.url, profile.platform || '', proxyName, ...planNames, ...(profile.tags || [])]
          .join(' ');
        return normalizeSearchValue(searchable).includes(normalizedSearch);
      })
    : profiles;

  return (
    <>
      <PageHead
        title="Perfiles / Webs"
        description="Cada perfil puede pertenecer a uno o varios planes, tener una categoría visible en userFLOW y mantener una sesión Chromium administrada. El proxy es opcional."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, color: '#94a3b8', pointerEvents: 'none' }} />
              <input
                className="input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar perfil..."
                aria-label="Buscar perfiles"
                autoComplete="off"
                style={{ width: 270, paddingLeft: 34 }}
              />
            </label>
            <button className="button primary" onClick={() => openEditor('new')}>
              <Plus size={14} />
              Nuevo perfil
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} />

      {profiles.length === 0 ? (
        <Card>
          <Empty title="No hay perfiles" description="Agrega la primera web o perfil que quieras administrar." />
        </Card>
      ) : filteredProfiles.length === 0 ? (
        <Card>
          <Empty title="No se encontraron perfiles" description={`No hay coincidencias para “${searchQuery.trim()}”. Prueba con otra parte del nombre, categoría, plan o URL.`} />
        </Card>
      ) : (
        <div className="grid three">
          {filteredProfiles.map((profile) => {
            const selectedProxy = proxies.find((proxy) => proxy.id === defaultProxyId(profile.id));
            const session = stateFor(profile.id);
            const managed = profile.session_mode === 'managed-first-party';
            const profilePlanIds = planIdsFor(profile.id);
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
                    <Badge tone={profile.platform ? 'neutral' : 'warn'}>{profile.platform || 'Sin categoría'}</Badge>
                    <Badge tone={profilePlanIds.length > 0 ? 'neutral' : 'warn'}>
                      {profilePlanIds.length === 0
                        ? 'Sin plan'
                        : `${profilePlanIds.length} ${profilePlanIds.length === 1 ? 'plan' : 'planes'}`}
                    </Badge>
                    {selectedProxy ? (
                      <Badge tone={selectedProxy.enabled ? 'neutral' : 'warn'}>
                        Proxy: {selectedProxy.name}{selectedProxy.enabled ? '' : ' · inactivo'}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">{managed ? 'Sin proxy · IP del cliente' : 'Conexión directa'}</Badge>
                    )}
                    {managed && (
                      <Badge tone={session?.status === 'active' ? 'ok' : session?.status === 'needs_auth' ? 'warn' : 'bad'}>
                        Sesión: {session?.status === 'active' ? `activa · v${session.version}` : session?.status === 'needs_auth' ? 'requiere acceso' : 'sin cargar'}
                      </Badge>
                    )}
                    {managed && selectedProxy && session?.public_ip && <Badge>IP: {session.public_ip}</Badge>}
                  </div>
                  {managed && (
                    <div className="toolbar" style={{ margin: '10px 0 0' }}>
                      <button className="button secondary small" disabled={sessionAction === profile.id} onClick={() => void startCapture(profile)}>
                        {session?.status === 'active' ? <RefreshCw size={12} /> : <KeyRound size={12} />}
                        {session?.status === 'active' ? 'Renovar sesión' : 'Cargar sesión'}
                      </button>
                      {session?.status === 'active' && (
                        <button className="button danger small" disabled={sessionAction === profile.id} onClick={() => void clearSession(profile)}>
                          Borrar sesión
                        </button>
                      )}
                    </div>
                  )}
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
              <input className="input" name="label" defaultValue={current ? profileLabel(current) : ''} required maxLength={100} placeholder="chatgpt #1" />
            </Field>
            <Field label="URL HTTPS" className="span-2">
              <input className="input" name="url" type="url" defaultValue={current?.url || ''} required placeholder="https://..." />
            </Field>
            <Field
              label="Categoría"
              className="span-2"
              help="Escoge una categoría existente o escribe un nombre nuevo. Las categorías nuevas aparecerán automáticamente en userFLOW cuando el plan tenga al menos un perfil de esa categoría."
            >
              <input
                className="input"
                name="category"
                list="profile-category-options"
                defaultValue={current?.platform || 'Chat'}
                required
                maxLength={80}
                placeholder="Chat, Imagen, Video..."
              />
              <datalist id="profile-category-options">
                {categoryOptions.map((categoryName) => <option value={categoryName} key={categoryName} />)}
              </datalist>
            </Field>

            <div className="span-2 field">
              <label>Imagen del perfil</label>
              <div tabIndex={0} onPaste={pasteImage} onDragOver={(event) => event.preventDefault()} onDrop={dropImage} style={{ border: '1px dashed #cbd5e1', borderRadius: 12, padding: 12, display: 'flex', alignItems: 'center', gap: 14, background: '#f8fafc', outline: 'none' }}>
                <div style={{ width: 118, height: 78, flex: '0 0 auto', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
                  {previewUrl ? <img src={previewUrl} alt="Vista previa" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImagePlus size={26} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>Subir, arrastrar o pegar una imagen</div>
                  <div className="help" style={{ marginBottom: 9 }}>JPG/JPEG, PNG, WebP o GIF · máximo 5 MB · también puedes copiar una imagen y presionar Ctrl+V aquí.</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <label className="button secondary small" style={{ cursor: 'pointer' }}>
                      <Upload size={12} /> Elegir imagen
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" hidden onChange={(event) => { chooseImage(event.currentTarget.files?.[0] || null); event.currentTarget.value = ''; }} />
                    </label>
                    {imageFile && <span className="help">{imageFile.name || 'Imagen pegada'} · {(imageFile.size / 1024).toFixed(0)} KB</span>}
                  </div>
                </div>
              </div>
            </div>

            <Field label="O usar imagen por URL HTTPS" className="span-2" help="Opcional. Si subes o pegas una imagen, se guardará automáticamente y esta URL será reemplazada.">
              <input className="input" name="imageUrl" type="url" value={imageUrl} onChange={(event) => changeImageUrl(event.target.value)} placeholder="https://.../imagen.jpg" />
            </Field>

            <Field
              label={`Disponible en planes (${selectedPlanIds.length})`}
              className="span-2"
              help="Puedes incluir este perfil en uno, varios o todos los planes. Los planes nuevos que crees después no se seleccionarán automáticamente."
            >
              <div style={{ border: '1px solid #dbe2ea', borderRadius: 12, padding: 12 }}>
                <div className="toolbar" style={{ margin: '0 0 10px' }}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setSelectedPlanIds(plans.map((plan) => plan.id))}
                    disabled={plans.length === 0}
                  >
                    Todos los planes
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setSelectedPlanIds([])}
                    disabled={selectedPlanIds.length === 0}
                  >
                    Ninguno
                  </button>
                </div>
                {plans.length === 0 ? (
                  <div className="help">Todavía no hay planes creados. Puedes guardar el perfil y asignarlo a un plan más adelante.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                    {plans.map((plan) => (
                      <label
                        key={plan.id}
                        style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', border: '1px solid #e5eaf0', borderRadius: 10, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(plan.id)}
                          onChange={() => togglePlan(plan.id)}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span className="table-primary">{plan.name}</span>
                          <span className="table-secondary" style={{ display: 'block' }}>
                            {plan.enabled ? (plan.duration_days ? `${plan.duration_days} días` : 'Sin duración fija') : 'Inactivo'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <Field
              label="Proxy (opcional)"
              className="span-2"
              help={sessionMode === 'managed-first-party'
                ? 'Opcional. Si eliges uno, todos los clientes de este perfil usarán esa salida y no habrá fallback directo. Sin proxy, cada cliente usará su propia IP pública.'
                : 'Opcional. Si no eliges uno, el perfil puede usar conexión directa o la configuración de la asignación.'}
            >
              <select className="select" name="proxyId" defaultValue={currentProxyId || ''}>
                <option value="">Sin proxy · conexión directa</option>
                {proxies.map((proxy) => (
                  <option value={proxy.id} key={proxy.id}>{proxy.name} · {proxy.host}:{proxy.port}{proxy.enabled ? '' : ' · inactivo'}</option>
                ))}
              </select>
            </Field>

            <Field label="Modo de sesión" className="span-2">
              <select className="select" name="sessionMode" value={sessionMode} onChange={(event) => setSessionMode(event.target.value as SessionMode)}>
                <option value="manual-login">Login manual en el Client</option>
                <option value="managed-first-party">Sesión Chromium administrada</option>
              </select>
            </Field>

            {sessionMode === 'managed-first-party' && (
              <>
                <div className="span-2" style={{ padding: 12, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12, display: 'flex', gap: 10 }}>
                  <ShieldCheck size={18} />
                  <div className="help">El correo y la contraseña se cifran para preparar o renovar la sesión y no se entregan al cliente. Si eliges un proxy, el cliente deberá usar ese proxy; sin proxy, la sesión funciona por conexión directa.</div>
                </div>
                <Field label="Correo / usuario de acceso" className="span-2">
                  <input className="input" name="loginUsername" autoComplete="off" defaultValue={currentState?.login_username || ''} required placeholder="correo@dominio.com" />
                </Field>
                <Field label="Contraseña" className="span-2" help={currentState?.has_credentials ? 'Déjala vacía para conservar la contraseña actual.' : 'Se usará solo en el Session Manager para preparar la sesión.'}>
                  <input className="input" name="loginPassword" type="password" autoComplete="new-password" required={!currentState?.has_credentials} placeholder={currentState?.has_credentials ? '•••••••• (sin cambios)' : 'Contraseña de la cuenta'} />
                </Field>
              </>
            )}

            <Field label="Estado">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}

      {captureLaunch && (
        <Modal
          title={`Abrir Chromium · ${captureLaunch.profileName}`}
          onClose={() => setCaptureLaunch(null)}
          actions={<button className="button secondary" onClick={() => setCaptureLaunch(null)}>Cerrar</button>}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ padding: 14, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12 }}>
              <strong>userFLEX intentó abrir el Chromium automáticamente.</strong>
              <div className="help" style={{ marginTop: 6 }}>Si Windows o el navegador no mostró nada, usa el botón siguiente. Este segundo clic conserva el permiso del navegador para abrir la aplicación local.</div>
            </div>
            <button className="button primary" onClick={() => launchSessionManager(captureLaunch.launchUrl)}>
              <Globe2 size={14} />
              Abrir Chromium ahora
            </button>
            <a className="button secondary" href={SESSION_MANAGER_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              Instalar / actualizar Session Manager v0.1.2
            </a>
            <div className="help">Al abrirse Chromium, completa el primer inicio de sesión, 2FA o CAPTCHA si aparece y pulsa <b>Guardar sesión</b> en el panel flotante de userFLEX. El enlace de captura es temporal{captureLaunch.expiresAt ? ` y vence a las ${new Date(captureLaunch.expiresAt).toLocaleTimeString()}` : ''}.</div>
          </div>
        </Modal>
      )}
    </>
  );
}
