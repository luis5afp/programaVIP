import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EyeOff, Pencil, Plus, Search } from 'lucide-react';
import { api } from '../api';
import type { ContentRule, ContentRuleScope, Profile, ProfileContentRuleMembership } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead, SuccessBanner } from '../components/ui';

type Editor = ContentRule | 'new' | null;

export function ContentRulesView() {
  const [items, setItems] = useState<ContentRule[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<ProfileContentRuleMembership[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('');
  const [selector, setSelector] = useState('');
  const [scope, setScope] = useState<ContentRuleScope>('selective');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    try {
      const [rules, profileRows, membershipRows] = await Promise.all([
        api.contentRules.list(),
        api.profiles.list(),
        api.contentRules.memberships(),
      ]);
      setItems(rules);
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
      [item.name, item.description || '', item.domain, item.selector, item.scope]
        .some((part) => part.toLocaleLowerCase('es').includes(value)));
  }, [items, search]);

  function profileIdsFor(ruleId: string) {
    return memberships
      .filter((item) => item.rule_id === ruleId)
      .map((item) => item.profile_id);
  }

  function openEditor(value: Exclude<Editor, null>) {
    const current = value === 'new' ? null : value;
    setName(current?.name || '');
    setDescription(current?.description || '');
    setDomain(current?.domain || '');
    setSelector(current?.selector || '');
    setScope(current?.scope || 'selective');
    setSelectedProfileIds(current ? profileIdsFor(current.id) : []);
    setError(null);
    setSuccess(null);
    setEditor(value);
  }

  function closeEditor() {
    setEditor(null);
    setName('');
    setDescription('');
    setDomain('');
    setSelector('');
    setScope('selective');
    setSelectedProfileIds([]);
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

      if (!name.trim()) throw new Error('Ingresa un nombre para la regla.');
      if (!domain.trim()) throw new Error('Ingresa el dominio donde se aplicará.');
      if (!selector.trim()) throw new Error('Ingresa el selector CSS del elemento.');

      let saved: ContentRule;
      const input = {
        name: name.trim(),
        description: description.trim(),
        domain: domain.trim(),
        selector: selector.trim(),
        scope,
      };
      if (editor === 'new') saved = await api.contentRules.create(input);
      else saved = await api.contentRules.update(editor.id, input);

      await api.contentRules.setProfiles(saved.id, scope === 'selective' ? selectedProfileIds : []);
      closeEditor();
      setSuccess(`${saved.name} guardada en el núcleo de Browser Guard.`);
      await load();
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(item: ContentRule) {
    try {
      setError(null);
      setSuccess(null);
      const updated = await api.contentRules.update(item.id, { enabled: !item.enabled });
      setSuccess(updated.enabled
        ? `${updated.name} activada. Se aplicará en el próximo inicio/reinicio del perfil.`
        : `${updated.name} desactivada sin eliminarla.`);
      await load();
    } catch (actionError: any) {
      setError(actionError.message);
    }
  }

  return (
    <>
      <PageHead
        title="Reglas de página"
        description="Bloqueo visual integrado en el núcleo de userFLOW. Guarda selectores CSS por dominio y Browser Guard oculta esos elementos sin depender de extensiones ni servidores externos."
        actions={
          <>
            <div className="search-box">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar regla..." />
            </div>
            <button className="button primary" onClick={() => openEditor('new')}>
              <Plus size={15} /> Nueva regla
            </button>
          </>
        }
      />

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      {filtered.length === 0 ? (
        <Empty
          title={items.length ? 'No hay resultados' : 'No hay reglas de página'}
          description={items.length
            ? 'Prueba con otra búsqueda.'
            : 'Crea una regla para ocultar banners, overlays o elementos molestos desde Browser Guard.'}
        />
      ) : (
        <div className="extension-admin-list">
          {filtered.map((item) => {
            const assignedIds = profileIdsFor(item.id);
            const assignedNames = profiles
              .filter((profile) => assignedIds.includes(profile.id))
              .map((profile) => profile.tags?.[0] || profile.name);
            return (
              <Card className="extension-admin-card" key={item.id}>
                <div className="extension-admin-icon"><EyeOff size={22} /></div>
                <div className="extension-admin-main">
                  <div className="extension-admin-title">
                    <strong>{item.name}</strong>
                    <Badge tone={item.enabled ? 'ok' : 'neutral'}>{item.enabled ? 'Activa' : 'Desactivada'}</Badge>
                    <Badge>{item.scope === 'global' ? 'Global' : 'Selectiva'}</Badge>
                  </div>
                  <div className="extension-admin-meta">
                    <span>{item.domain === '*' ? 'Todos los dominios' : item.domain}</span>
                    <span>{item.scope === 'global' ? 'Todos los perfiles' : assignedNames.length ? `${assignedNames.length} perfiles` : 'Sin perfiles'}</span>
                  </div>
                  {item.description && <div className="extension-admin-description">{item.description}</div>}
                  <div className="extension-admin-status">
                    <EyeOff size={14} />
                    <span style={{ wordBreak: 'break-word' }}>{item.selector}</span>
                  </div>
                  {item.scope === 'selective' && assignedNames.length > 0 && (
                    <div className="extension-profile-chips">
                      {assignedNames.slice(0, 8).map((profileName) => <Badge key={profileName}>{profileName}</Badge>)}
                      {assignedNames.length > 8 && <Badge>+{assignedNames.length - 8}</Badge>}
                    </div>
                  )}
                </div>
                <div className="extension-admin-actions">
                  <button className="button secondary small" onClick={() => void toggleEnabled(item)}>
                    {item.enabled ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="button secondary small" onClick={() => openEditor(item)}>
                    <Pencil size={12} /> Editar
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editor && (
        <Modal
          title={editor === 'new' ? 'Nueva regla de página' : `Editar regla · ${editor.name}`}
          error={error}
          onClose={closeEditor}
          actions={
            <>
              <button className="button secondary" onClick={closeEditor} disabled={saving}>Cancelar</button>
              <button className="button primary" type="submit" form="content-rule-form" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          }
        >
          <form id="content-rule-form" className="form-grid" onSubmit={save}>
            <Field label="Nombre" className="span-2">
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                placeholder="Ej. Ocultar aviso de cuenta"
              />
            </Field>

            <Field label="Descripción" className="span-2" help="Opcional. Explica qué elemento oculta y por qué.">
              <textarea
                className="textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={2}
              />
            </Field>

            <Field
              label="Dominio"
              className="span-2"
              help="Ej. digen.ai. También cubre sus subdominios. Usa * solo cuando de verdad deba aplicarse a todas las páginas."
            >
              <input
                className="input"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                maxLength={255}
                required
                placeholder="digen.ai"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </Field>

            <Field
              label="Selector CSS"
              className="span-2"
              help="Browser Guard buscará únicamente este selector en el dominio indicado y ocultará los elementos que coincidan."
            >
              <textarea
                className="textarea"
                value={selector}
                onChange={(event) => setSelector(event.target.value)}
                maxLength={1000}
                rows={3}
                required
                placeholder='Ej. [role="dialog"] .upgrade-banner'
                spellCheck={false}
              />
            </Field>

            <Field label="Aplicar en" className="span-2">
              <div className="extension-scope-options">
                <label className={scope === 'global' ? 'active' : ''}>
                  <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />
                  <span><b>Todos los perfiles</b><small>La regla se entrega a todos los perfiles actuales y futuros.</small></span>
                </label>
                <label className={scope === 'selective' ? 'active' : ''}>
                  <input type="radio" checked={scope === 'selective'} onChange={() => setScope('selective')} />
                  <span><b>Perfiles seleccionados</b><small>La regla solo se entrega a los perfiles que marques.</small></span>
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
                      <input
                        type="checkbox"
                        checked={selectedProfileIds.includes(profile.id)}
                        onChange={() => toggleProfile(profile.id)}
                      />
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
          </form>
        </Modal>
      )}
    </>
  );
}
