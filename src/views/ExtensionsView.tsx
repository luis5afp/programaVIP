import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileArchive, Pencil, PlayCircle, Plus, Puzzle, RefreshCw, Search, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import type { ExtensionValidationJob, ManagedExtension, ManagedExtensionScope, Profile, ProfileExtensionMembership } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead, SuccessBanner } from '../components/ui';

type Editor = ManagedExtension | 'new' | null;

function launchCustomProtocol(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function validationTone(status: ManagedExtension['validation_status']) {
  if (status === 'runtime_valid') return 'ok' as const;
  if (status === 'package_valid') return 'warn' as const;
  return 'bad' as const;
}

function validationLabel(status: ManagedExtension['validation_status']) {
  if (status === 'runtime_valid') return 'Verificada en userFLOW';
  if (status === 'package_valid') return 'Paquete válido · falta prueba';
  if (status === 'incompatible') return 'Incompatible';
  return 'Error de carga';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function ExtensionsView() {
  const [items, setItems] = useState<ManagedExtension[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<ProfileExtensionMembership[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<ManagedExtensionScope>('selective');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testJob, setTestJob] = useState<ExtensionValidationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    try {
      const [extensionRows, profileRows, membershipRows] = await Promise.all([
        api.extensions.list(),
        api.profiles.list(),
        api.profileExtensions.list(),
      ]);
      setItems(extensionRows);
      setProfiles(profileRows);
      setMemberships(membershipRows);
      setError(null);
    } catch (loadError: any) {
      setError(loadError.message);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('es');
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.description || '', item.version, item.scope, item.validation_status]
        .some((part) => part.toLocaleLowerCase('es').includes(value)));
  }, [items, search]);

  function profileIdsFor(extensionId: string) {
    return memberships
      .filter((item) => item.extension_id === extensionId)
      .map((item) => item.profile_id);
  }

  function openEditor(value: Exclude<Editor, null>) {
    const current = value === 'new' ? null : value;
    setName(current?.name || '');
    setDescription(current?.description || '');
    setScope(current?.scope || 'selective');
    setSelectedProfileIds(current ? profileIdsFor(current.id) : []);
    setPackageFile(null);
    setError(null);
    setSuccess(null);
    setEditor(value);
  }

  function closeEditor() {
    setEditor(null);
    setName('');
    setDescription('');
    setScope('selective');
    setSelectedProfileIds([]);
    setPackageFile(null);
    setError(null);
  }

  function toggleProfile(profileId: string) {
    setSelectedProfileIds((current) => current.includes(profileId)
      ? current.filter((id) => id !== profileId)
      : [...current, profileId]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      if (!name.trim()) throw new Error('Ingresa un nombre para la extensión.');
      if (editor === 'new' && !packageFile) throw new Error('Selecciona el paquete ZIP de la extensión.');

      let saved: ManagedExtension;
      if (editor === 'new') {
        saved = await api.extensions.create({
          name: name.trim(),
          description: description.trim(),
          scope,
          package: packageFile as File,
        });
      } else {
        saved = await api.extensions.update(editor.id, {
          name: name.trim(),
          description: description.trim() || null,
          scope,
        });
        if (packageFile) saved = await api.extensions.uploadPackage(saved.id, packageFile);
      }
      await api.extensions.setProfiles(saved.id, scope === 'selective' ? selectedProfileIds : []);
      closeEditor();
      setSuccess(
        saved.validation_status === 'package_valid'
          ? `${saved.name} guardada. Ahora usa “Probar en userFLOW” para verificarla en Chrome.`
          : saved.validation_message || 'Extensión guardada.',
      );
      await load();
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(item: ManagedExtension) {
    try {
      setError(null);
      setSuccess(null);
      const updated = await api.extensions.update(item.id, { enabled: !item.enabled });
      setSuccess(updated.enabled ? `${updated.name} activada.` : `${updated.name} desactivada.`);
      await load();
    } catch (actionError: any) {
      setError(actionError.message);
    }
  }

  async function remove(item: ManagedExtension) {
    if (!confirm(`¿Eliminar la extensión ${item.name}? Se quitará de todos los perfiles.`)) return;
    try {
      setError(null);
      setSuccess(null);
      await api.extensions.remove(item.id);
      setSuccess('Extensión eliminada correctamente.');
      await load();
    } catch (actionError: any) {
      setError(actionError.message);
    }
  }

  async function pollTest(jobId: string, attempts = 0): Promise<void> {
    try {
      const result = await api.extensions.testStatus(jobId);
      setTestJob(result.job);
      if (['pass', 'fail', 'expired'].includes(result.job.status)) {
        setTestingId(null);
        await load();
        if (result.job.status === 'pass') setSuccess('userFLOW confirmó que Chrome cargó la extensión correctamente.');
        else setError(result.job.error || 'La prueba de la extensión no se completó correctamente.');
        return;
      }
      if (attempts >= 45) {
        setTestingId(null);
        setError('La prueba sigue pendiente. Puedes volver a probarla o recargar el estado.');
        return;
      }
      window.setTimeout(() => void pollTest(jobId, attempts + 1), 2000);
    } catch (pollError: any) {
      setTestingId(null);
      setError(pollError.message);
    }
  }

  async function runtimeTest(item: ManagedExtension) {
    try {
      setError(null);
      setSuccess(null);
      setTestJob(null);
      setTestingId(item.id);
      const result = await api.extensions.runtimeTest(item.id);
      launchCustomProtocol(result.launch_url);
      window.setTimeout(() => void pollTest(result.job_id), 1500);
    } catch (actionError: any) {
      setTestingId(null);
      setError(actionError.message);
    }
  }

  return (
    <>
      <PageHead
        title="Extensiones"
        description="Carga una vez las extensiones administradas, valida el paquete y pruébalas realmente en userFLOW. Las globales se aplican a todos los perfiles; las selectivas se asignan a perfiles concretos."
        actions={
          <>
            <div className="search-box">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar extensión..." />
            </div>
            <button className="button primary" onClick={() => openEditor('new')}>
              <Plus size={15} /> Nueva extensión
            </button>
          </>
        }
      />

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      {testJob && (
        <Card className="extension-test-card">
          <div className="toolbar" style={{ margin: 0 }}>
            <strong>Prueba real en userFLOW</strong>
            <Badge tone={testJob.status === 'pass' ? 'ok' : testJob.status === 'fail' || testJob.status === 'expired' ? 'bad' : 'warn'}>
              {testJob.status}
            </Badge>
          </div>
          <div className="help" style={{ marginTop: 7 }}>
            {testJob.status === 'pending' ? 'Esperando que Windows abra userFLOW...' :
              testJob.status === 'running' ? 'userFLOW está abriendo Chrome con Browser Guard + la extensión seleccionada y comprobando chrome://extensions.' :
                testJob.status === 'pass' ? 'Chrome confirmó la carga de la extensión.' :
                  testJob.error || 'La prueba no fue satisfactoria.'}
          </div>
          {testJob.result?.extensionCount !== undefined && (
            <div className="help" style={{ marginTop: 5 }}>Extensiones detectadas por Chrome: {testJob.result.extensionCount}</div>
          )}
        </Card>
      )}

      {filtered.length === 0 ? (
        <Empty title={items.length ? 'No hay resultados' : 'No hay extensiones'} description={items.length ? 'Prueba con otra búsqueda.' : 'Carga la primera extensión administrada para empezar.'} />
      ) : (
        <div className="extension-admin-list">
          {filtered.map((item) => {
            const assignedIds = profileIdsFor(item.id);
            const assignedNames = profiles.filter((profile) => assignedIds.includes(profile.id)).map((profile) => profile.tags?.[0] || profile.name);
            return (
              <Card className="extension-admin-card" key={item.id}>
                <div className="extension-admin-icon"><Puzzle size={22} /></div>
                <div className="extension-admin-main">
                  <div className="extension-admin-title">
                    <strong>{item.name}</strong>
                    <Badge tone={item.enabled ? 'ok' : 'neutral'}>{item.enabled ? 'Activa' : 'Desactivada'}</Badge>
                    <Badge tone={validationTone(item.validation_status)}>{validationLabel(item.validation_status)}</Badge>
                  </div>
                  <div className="extension-admin-meta">
                    <span>v{item.version}</span>
                    <span>{formatBytes(item.package_size)}</span>
                    <span>{item.scope === 'global' ? 'Todos los perfiles' : assignedNames.length ? `${assignedNames.length} perfiles` : 'Sin perfiles'}</span>
                    <span>SHA {item.package_sha256.slice(0, 10)}…</span>
                  </div>
                  {item.description && <div className="extension-admin-description">{item.description}</div>}
                  <div className="extension-admin-status">
                    {item.validation_status === 'runtime_valid' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                    <span>{item.validation_message || validationLabel(item.validation_status)}</span>
                  </div>
                  {item.scope === 'selective' && assignedNames.length > 0 && (
                    <div className="extension-profile-chips">
                      {assignedNames.slice(0, 8).map((profileName) => <Badge key={profileName}>{profileName}</Badge>)}
                      {assignedNames.length > 8 && <Badge>+{assignedNames.length - 8}</Badge>}
                    </div>
                  )}
                </div>
                <div className="extension-admin-actions">
                  <button className="button secondary small" onClick={() => void runtimeTest(item)} disabled={testingId !== null || item.validation_status === 'incompatible'}>
                    {testingId === item.id ? <RefreshCw size={12} /> : <PlayCircle size={12} />}
                    {testingId === item.id ? 'Probando...' : 'Probar en userFLOW'}
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => void toggleEnabled(item)}
                    disabled={item.validation_status !== 'runtime_valid' && !item.enabled}
                    title={item.validation_status !== 'runtime_valid' && !item.enabled ? 'Primero debe pasar la prueba real en userFLOW.' : ''}
                  >
                    {item.enabled ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="button secondary small" onClick={() => openEditor(item)}><Pencil size={12} /> Editar</button>
                  <button className="button danger small" onClick={() => void remove(item)}><Trash2 size={12} /> Eliminar</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editor && (
        <Modal
          title={editor === 'new' ? 'Nueva extensión administrada' : `Editar extensión · ${editor.name}`}
          error={error}
          onClose={closeEditor}
          actions={
            <>
              <button className="button secondary" onClick={closeEditor} disabled={saving}>Cancelar</button>
              <button className="button primary" type="submit" form="extension-form" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="extension-form" className="form-grid" onSubmit={save}>
            <Field label="Nombre" className="span-2">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Ej. Helper Google" />
            </Field>
            <Field label="Descripción" className="span-2" help="Explica para qué sirve. Este texto ayudará a decidir en qué perfiles activarla.">
              <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} />
            </Field>

            <Field
              label={editor === 'new' ? 'Paquete ZIP' : 'Reemplazar paquete ZIP (opcional)'}
              className="span-2"
              help="El ZIP debe contener manifest.json en la raíz. userFLEX acepta extensiones Chrome Manifest V3 y valida rutas, archivos, permisos y SHA-256."
            >
              <label className="extension-upload-zone">
                <FileArchive size={22} />
                <span>
                  <strong>{packageFile ? packageFile.name : editor === 'new' ? 'Seleccionar extensión .zip' : 'Mantener paquete actual'}</strong>
                  <small>{packageFile ? formatBytes(packageFile.size) : 'Máximo 20 MB'}</small>
                </span>
                <span className="button secondary small"><Upload size={12} /> Elegir ZIP</span>
                <input
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  hidden
                  required={editor === 'new'}
                  onChange={(event) => setPackageFile(event.currentTarget.files?.[0] || null)}
                />
              </label>
            </Field>

            <Field label="Aplicar en" className="span-2" tooltip="Global aplica automáticamente a perfiles actuales y futuros. Selectiva permite escoger perfiles concretos.">
              <div className="extension-scope-options">
                <label className={scope === 'global' ? 'active' : ''}>
                  <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />
                  <span><b>Todos los perfiles</b><small>Global: se aplicará automáticamente cuando esté validada y activa.</small></span>
                </label>
                <label className={scope === 'selective' ? 'active' : ''}>
                  <input type="radio" checked={scope === 'selective'} onChange={() => setScope('selective')} />
                  <span><b>Perfiles seleccionados</b><small>Podrás elegir aquí y también desde Crear/Editar perfil.</small></span>
                </label>
              </div>
            </Field>

            {scope === 'selective' && (
              <Field label={`Perfiles (${selectedProfileIds.length})`} className="span-2">
                <div className="toolbar" style={{ margin: '0 0 8px' }}>
                  <button type="button" className="button secondary small" onClick={() => setSelectedProfileIds(profiles.map((profile) => profile.id))}>Todos</button>
                  <button type="button" className="button secondary small" onClick={() => setSelectedProfileIds([])}>Ninguno</button>
                </div>
                <div className="extension-profile-picker">
                  {profiles.map((profile) => (
                    <label key={profile.id} className={selectedProfileIds.includes(profile.id) ? 'selected' : ''}>
                      <input type="checkbox" checked={selectedProfileIds.includes(profile.id)} onChange={() => toggleProfile(profile.id)} />
                      <span>
                        <b>{profile.tags?.[0] || profile.name}</b>
                        <small>{profile.platform || 'Sin categoría'} · {profile.enabled ? 'Activo' : 'Inactivo'}</small>
                      </span>
                    </label>
                  ))}
                  {profiles.length === 0 && <div className="help">No hay perfiles creados todavía.</div>}
                </div>
              </Field>
            )}

            {editor !== 'new' && (
              <div className="span-2 extension-current-validation">
                <Badge tone={validationTone(editor.validation_status)}>{validationLabel(editor.validation_status)}</Badge>
                <span>{editor.validation_message || 'Sin detalle adicional.'}</span>
              </div>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
