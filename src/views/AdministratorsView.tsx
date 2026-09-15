import { FormEvent, useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, Search, Shield, Trash2, UserCheck, UserX } from 'lucide-react';
import { adminUsersApi } from '../admin-api';
import { ApiError } from '../api';
import type { AdminRole, AdminSession, AdminUser } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead } from '../components/ui';

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function dateTime(value: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-PE');
}

function roleLabel(role: AdminRole) {
  return role === 'owner' ? 'Propietario' : 'Administrador';
}

function errorMessage(error: unknown) {
  const apiError = error as ApiError;
  if (apiError.code === 'LAST_OWNER') return 'Debe existir al menos un Propietario activo.';
  if (apiError.code === 'CANNOT_DELETE_SELF') return 'No puedes eliminar la cuenta con la que has iniciado sesión.';
  if (apiError.code === 'CANNOT_DISABLE_SELF') return 'No puedes suspender tu propia cuenta mientras la estás usando.';
  if (apiError.code === 'CONFLICT') return 'Ya existe un administrador con ese usuario o correo.';
  return apiError.message || 'No se pudo completar la operación.';
}

export function AdministratorsView({ session }: { session: AdminSession }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await adminUsersApi.list());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const query = normalize(search.trim());
    if (!query) return rows;
    return rows.filter((row) => normalize([
      row.display_name,
      row.username,
      row.email || '',
      roleLabel(row.role),
      row.enabled ? 'activo' : 'suspendido',
      dateTime(row.last_login_at),
    ].join(' ')).includes(query));
  }, [rows, search]);

  async function toggleEnabled(row: AdminUser) {
    const action = row.enabled ? 'suspender' : 'activar';
    if (!window.confirm(`¿Deseas ${action} a ${row.display_name}?`)) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await adminUsersApi.update(row.id, { enabled: !row.enabled });
      setSuccess(row.enabled ? 'Administrador suspendido.' : 'Administrador activado.');
      await load();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally { setBusy(false); }
  }

  async function remove(row: AdminUser) {
    if (!window.confirm(`Eliminar a ${row.display_name} (${row.username})? Esta acción cerrará sus accesos al panel.`)) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await adminUsersApi.remove(row.id);
      setSuccess('Administrador eliminado.');
      await load();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead
        title="Administradores"
        description="Controla quién puede entrar al panel userFLEX. Sólo los Propietarios pueden crear, suspender, eliminar o cambiar el rol de otros administradores."
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, color: '#94a3b8', pointerEvents: 'none' }} />
              <input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, usuario, correo..." style={{ width: 300, paddingLeft: 34 }} />
            </label>
            <button className="button primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={15} /> Nuevo administrador</button>
          </div>
        }
      />
      <ErrorBanner message={error} />
      {success ? <div className="success-banner">{success}</div> : null}
      <Card>
        {loading && rows.length === 0 ? (
          <Empty title="Cargando administradores" description="Consultando accesos autorizados." />
        ) : filtered.length === 0 ? (
          <Empty title={rows.length ? 'Sin coincidencias' : 'Sin administradores'} description={rows.length ? 'No hay administradores que coincidan con la búsqueda.' : 'Crea el primer administrador adicional cuando lo necesites.'} />
        ) : (
          <div className="table-wrap">
            <table style={{ minWidth: 980 }}>
              <thead><tr><th>Administrador</th><th>Usuario</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td><div className="table-primary">{row.display_name}{row.id === session.id ? ' · Tú' : ''}</div><div className="table-secondary">{row.email || 'Sin correo'}</div></td>
                    <td className="mono">{row.username}</td>
                    <td><Badge tone={row.role === 'owner' ? 'warn' : 'neutral'}><Shield size={10} /> {roleLabel(row.role)}</Badge></td>
                    <td>{dateTime(row.last_login_at)}</td>
                    <td><Badge tone={row.enabled ? 'ok' : 'bad'}>{row.enabled ? 'Activo' : 'Suspendido'}</Badge></td>
                    <td>
                      <div className="toolbar" style={{ margin: 0, gap: 6 }}>
                        <button className="button secondary small" type="button" onClick={() => setEditing(row)}><Pencil size={12} /> Editar</button>
                        <button className="button secondary small" type="button" onClick={() => setPasswordTarget(row)}><KeyRound size={12} /> Contraseña</button>
                        <button className="button secondary small" type="button" disabled={busy || row.id === session.id} onClick={() => void toggleEnabled(row)}>{row.enabled ? <UserX size={12} /> : <UserCheck size={12} />}{row.enabled ? 'Suspender' : 'Activar'}</button>
                        <button className="button danger small" type="button" disabled={busy || row.id === session.id} onClick={() => void remove(row)}><Trash2 size={12} /> Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {createOpen ? <CreateAdminModal onClose={() => setCreateOpen(false)} onSaved={async () => { setCreateOpen(false); setSuccess('Administrador creado.'); await load(); }} setGlobalError={setError} /> : null}
      {editing ? <EditAdminModal row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setSuccess('Administrador actualizado.'); await load(); }} setGlobalError={setError} /> : null}
      {passwordTarget ? <PasswordModal row={passwordTarget} onClose={() => setPasswordTarget(null)} onSaved={() => { setPasswordTarget(null); setSuccess('Contraseña actualizada.'); }} setGlobalError={setError} /> : null}
    </>
  );
}

function CreateAdminModal({ onClose, onSaved, setGlobalError }: { onClose: () => void; onSaved: () => Promise<void>; setGlobalError: (value: string | null) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setGlobalError(null);
    if (password !== confirmPassword) { setGlobalError('Las contraseñas no coinciden.'); return; }
    if (password.length < 10) { setGlobalError('La contraseña debe tener al menos 10 caracteres.'); return; }
    setBusy(true);
    try {
      await adminUsersApi.create({ displayName: displayName.trim(), username: username.trim(), email: email.trim() || undefined, role, password });
      await onSaved();
    } catch (error) { setGlobalError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Modal title="Nuevo administrador" onClose={onClose} actions={<><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" form="create-admin-form" type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear administrador'}</button></>}><form id="create-admin-form" onSubmit={submit}><div className="form-grid"><Field label="Nombre"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} /></Field><Field label="Usuario"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={120} autoComplete="off" /></Field><Field label="Correo"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={180} /></Field><Field label="Rol"><select className="select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}><option value="admin">Administrador</option><option value="owner">Propietario</option></select></Field><Field label="Contraseña" help="Mínimo 10 caracteres."><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={256} autoComplete="new-password" /></Field><Field label="Confirmar contraseña"><input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} maxLength={256} autoComplete="new-password" /></Field></div></form></Modal>;
}

function EditAdminModal({ row, onClose, onSaved, setGlobalError }: { row: AdminUser; onClose: () => void; onSaved: () => Promise<void>; setGlobalError: (value: string | null) => void }) {
  const [displayName, setDisplayName] = useState(row.display_name);
  const [email, setEmail] = useState(row.email || '');
  const [role, setRole] = useState<AdminRole>(row.role);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setGlobalError(null);
    try {
      await adminUsersApi.update(row.id, { displayName: displayName.trim(), email: email.trim() || null, role });
      await onSaved();
    } catch (error) { setGlobalError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Modal title={`Editar administrador · ${row.username}`} onClose={onClose} actions={<><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" form="edit-admin-form" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></>}><form id="edit-admin-form" onSubmit={submit}><div className="form-grid"><Field label="Nombre"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} /></Field><Field label="Correo"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={180} /></Field><Field label="Rol" className="span-2"><select className="select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}><option value="admin">Administrador</option><option value="owner">Propietario</option></select></Field></div></form></Modal>;
}

function PasswordModal({ row, onClose, onSaved, setGlobalError }: { row: AdminUser; onClose: () => void; onSaved: () => void; setGlobalError: (value: string | null) => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setGlobalError(null);
    if (password !== confirmPassword) { setGlobalError('Las contraseñas no coinciden.'); return; }
    if (password.length < 10) { setGlobalError('La contraseña debe tener al menos 10 caracteres.'); return; }
    setBusy(true);
    try { await adminUsersApi.password(row.id, password); onSaved(); }
    catch (error) { setGlobalError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Modal title={`Cambiar contraseña · ${row.username}`} onClose={onClose} actions={<><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" form="password-admin-form" type="submit" disabled={busy}>{busy ? 'Actualizando…' : 'Cambiar contraseña'}</button></>}><form id="password-admin-form" onSubmit={submit}><div className="grid"><Field label="Nueva contraseña" help="Mínimo 10 caracteres. Las demás sesiones de esta cuenta se cerrarán."><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={256} autoComplete="new-password" /></Field><Field label="Confirmar contraseña"><input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} maxLength={256} autoComplete="new-password" /></Field></div></form></Modal>;
}
