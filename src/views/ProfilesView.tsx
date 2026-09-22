import { ClipboardEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Globe2, ImagePlus, KeyRound, Pencil, Plus, Puzzle, RefreshCw, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import type { Assignment, AuthStrategy, BrowserEngine, Client, CookieImportInspection, ExtensionStrategy, ManagedExtension, NetworkStrategy, Plan, Profile, ProfileExtensionMembership, ProfileProxyDefault, ProfileSessionState, ProfileValidation, ProfileValidationJob, ProxyRecord, SessionMode, StorageStrategy } from '../types';
import { Badge, Card, Empty, ErrorBanner, Field, Modal, PageHead, SuccessBanner } from '../components/ui';

type Editor = Profile | 'new' | null;
type CaptureLaunch = {
  profileId: string;
  profileName: string;
  launchUrl: string;
  saveUrl: string;
  expiresAt: string | null;
  baselineVersion: number;
} | null;

type ProfilePlanMembership = {
  profile_id: string;
  plan_id: string;
  created_at: string;
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_COOKIE_JSON_BYTES = 8 * 1024 * 1024;
const SESSION_MANAGER_DOWNLOAD_URL = 'https://github.com/luis5afp/programaVIP/releases/download/session-manager-v0.3.31/userFLEX-Session-Manager-0.3.31-Setup.exe';
const DEFAULT_CATEGORIES = ['Chat', 'Imagen', 'Video', 'Audio', 'Pro'];

const BROWSER_ENGINE_HELP: Record<BrowserEngine, string> = {
  'chrome-native': 'Usa Chrome instalado o el Chrome nativo autorizado. Es la opción recomendada para perfiles Google y para el uso normal.',
  nstchrome: 'Usa el runtime nstchrome empaquetado dentro de userFLOW. Si ese runtime no está instalado o autorizado, el perfil no podrá abrirse.',
};

const EXTENSION_STRATEGY_HELP: Record<ExtensionStrategy, string> = {
  'guard-only': 'Protección básica del navegador. Bloquea cambios o herramientas que el cliente no debe manipular, sin reglas especiales para un servicio concreto.',
  main: 'Modo protegido general con Browser Guard endurecido. Se usa como política principal cuando no hace falta un tratamiento específico de Google.',
  google: 'Modo protegido especializado para Google: contempla accounts.google.com, redirecciones regionales, autofill y validaciones específicas del flujo de acceso.',
  custom: 'Política protegida genérica para perfiles que no son Google. Permite usar el guard endurecido sin las adaptaciones específicas del modo GOOGLE.',
};

const AUTH_STRATEGY_HELP: Record<AuthStrategy, string> = {
  manual: 'El cliente inicia sesión manualmente. userFLEX no entrega snapshot ni credenciales; el estado queda guardado localmente en esa PC.',
  'cookie-snapshot': 'Restaura la sesión que el administrador guardó previamente. Es útil para reutilizar cookies y estado de sesión sin repetir el login completo.',
  'credential-autofill': 'Entrega temporalmente el correo y la contraseña al motor autorizado para completar el formulario. El usuario sigue resolviendo 2FA, CAPTCHA o confirmaciones cuando correspondan.',
  hybrid: 'Combina snapshot y credenciales: primero restaura la sesión guardada y, si la web vuelve a pedir acceso, usa autofill como respaldo.',
};

const STORAGE_STRATEGY_HELP: Record<StorageStrategy, string> = {
  'local-persistent': 'Conserva el estado solamente en el perfil local de la PC del cliente. No crea un snapshot portable para otras instalaciones.',
  'cookies-only': 'Importa únicamente cookies. Puede ser suficiente en sitios simples, pero algunas webs modernas también necesitan Local Storage, Session Storage o IndexedDB.',
  'portable-first-party': 'Restaura cookies, Local Storage, Session Storage e IndexedDB. Es el snapshot más completo para trasladar el estado de una sesión web.',
  'netflix-local-device': 'Política especial para Netflix: combina cookies administradas con almacenamiento local propio del dispositivo.',
};

const NETWORK_STRATEGY_HELP: Record<NetworkStrategy, string> = {
  'client-direct': 'No usa proxy. La web verá la IP pública real de la conexión del cliente.',
  'profile-proxy': 'Todo el tráfico del perfil usa el proxy fijo seleccionado. Si el proxy no está disponible, el perfil falla cerrado para evitar salir por la IP real.',
  'assigned-proxy': 'Cada cliente puede usar un proxy diferente asignado específicamente para este perfil.',
  auto: 'Modo de compatibilidad. userFLEX decide entre el proxy por defecto, la asignación del cliente y el comportamiento permitido por el tipo de perfil.',
};

const BROWSER_ENGINE_LABEL: Record<BrowserEngine, string> = {
  'chrome-native': 'Chrome nativo',
  nstchrome: 'nstchrome',
};

const AUTH_STRATEGY_LABEL: Record<AuthStrategy, string> = {
  manual: 'Login manual',
  'cookie-snapshot': 'Snapshot de sesión',
  'credential-autofill': 'Autofill de credenciales',
  hybrid: 'Híbrido',
};

const STORAGE_STRATEGY_LABEL: Record<StorageStrategy, string> = {
  'local-persistent': 'Persistencia local',
  'cookies-only': 'Solo cookies',
  'portable-first-party': 'Snapshot completo',
  'netflix-local-device': 'Netflix local',
};

const NETWORK_STRATEGY_LABEL: Record<NetworkStrategy, string> = {
  'client-direct': 'IP local / directa',
  'profile-proxy': 'Proxy fijo',
  'assigned-proxy': 'Proxy por cliente',
  auto: 'Automático',
};

const EXTENSION_STRATEGY_LABEL: Record<ExtensionStrategy, string> = {
  'guard-only': 'Guard only',
  main: 'MAIN',
  google: 'GOOGLE',
  custom: 'CUSTOM',
};

function profileLabel(profile: Profile) {
  return profile.tags?.[0] || profile.name;
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

const SNAPSHOT_VALIDATION_WARNING_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_VALIDATION_FRESH_MS = 24 * 60 * 60 * 1000;

function snapshotBadge(session: ProfileSessionState | null) {
  if (!session || session.status !== 'active') {
    return session?.status === 'needs_auth'
      ? { tone: 'warn' as const, compact: 'Snapshot: acceso', detail: 'Snapshot: requiere acceso' }
      : { tone: 'bad' as const, compact: 'Snapshot: sin cargar', detail: 'Snapshot: sin cargar' };
  }
  const version = Number(session.version || 0);
  const validatedAt = session.validated_at ? Date.parse(session.validated_at) : Number.NaN;
  if (!Number.isFinite(validatedAt)) {
    return {
      tone: 'warn' as const,
      compact: `Snapshot: v${version} · sin verificar`,
      detail: `Snapshot: guardado · v${version} · pendiente de prueba real`,
    };
  }
  const validationAge = Date.now() - validatedAt;
  if (validationAge > SNAPSHOT_VALIDATION_FRESH_MS) {
    return {
      tone: 'bad' as const,
      compact: `Snapshot: v${version} · vencida`,
      detail: `Snapshot: guardado · v${version} · validación vencida; requiere revisión`,
    };
  }
  if (validationAge > SNAPSHOT_VALIDATION_WARNING_MS) {
    return {
      tone: 'warn' as const,
      compact: `Snapshot: v${version} · validar pronto`,
      detail: `Snapshot: activo · v${version} · conviene validar antes de 24 h`,
    };
  }
  return {
    tone: 'ok' as const,
    compact: `Snapshot: v${version} · OK`,
    detail: `Snapshot: activo · v${version} · verificado recientemente`,
  };
}

function keeperBadge(session: ProfileSessionState | null) {
  const keeper = session?.keeper || null;
  if (!keeper) {
    return {
      tone: 'warn' as const,
      compact: 'Keeper: pendiente',
      detail: 'Session Keeper: pendiente de registrar; renueva el snapshot una vez con Session Manager v0.3.31+.',
    };
  }
  if (keeper.enabled === false || keeper.status === 'disabled') {
    return { tone: 'neutral' as const, compact: 'Keeper: apagado', detail: 'Session Keeper: desactivado' };
  }
  if (keeper.status === 'healthy') {
    return { tone: 'ok' as const, compact: 'Keeper: activo', detail: 'Session Keeper: activo · sesión central vigilada' };
  }
  if (keeper.status === 'needs_admin') {
    return {
      tone: 'bad' as const,
      compact: 'Keeper: requiere acceso',
      detail: `Session Keeper: requiere administrador${keeper.last_error ? ` · ${keeper.last_error}` : ''}`,
    };
  }
  if (keeper.status === 'error') {
    return {
      tone: 'bad' as const,
      compact: 'Keeper: error',
      detail: `Session Keeper: error${keeper.last_error ? ` · ${keeper.last_error}` : ''}`,
    };
  }
  return {
    tone: 'neutral' as const,
    compact: 'Keeper: registrado',
    detail: 'Session Keeper: registrado · esperando primera comprobación automática',
  };
}

function launchCustomProtocol(launchUrl: string) {
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
  const [extensions, setExtensions] = useState<ManagedExtension[]>([]);
  const [profileExtensionMemberships, setProfileExtensionMemberships] = useState<ProfileExtensionMembership[]>([]);
  const [selectedExtensionIds, setSelectedExtensionIds] = useState<string[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [proxyDefaults, setProxyDefaults] = useState<ProfileProxyDefault[]>([]);
  const [sessionStates, setSessionStates] = useState<ProfileSessionState[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [validationProfile, setValidationProfile] = useState<Profile | null>(null);
  const [validationClientId, setValidationClientId] = useState('');
  const [validationResult, setValidationResult] = useState<ProfileValidation | null>(null);
  const [validationJob, setValidationJob] = useState<ProfileValidationJob | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [captureLaunch, setCaptureLaunch] = useState<CaptureLaunch>(null);
  const [captureRetryReady, setCaptureRetryReady] = useState(false);
  const [captureSaveBusy, setCaptureSaveBusy] = useState(false);
  const [captureSaveMessage, setCaptureSaveMessage] = useState<string | null>(null);
  const captureRetryInFlight = useRef(false);
  const [browserEngine, setBrowserEngine] = useState<BrowserEngine>('chrome-native');
  const [authStrategy, setAuthStrategy] = useState<AuthStrategy>('manual');
  const [storageStrategy, setStorageStrategy] = useState<StorageStrategy>('local-persistent');
  const [networkStrategy, setNetworkStrategy] = useState<NetworkStrategy>('client-direct');
  const [extensionStrategy, setExtensionStrategy] = useState<ExtensionStrategy>('guard-only');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [showLoginUsername, setShowLoginUsername] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [profileUrl, setProfileUrl] = useState('');
  const [cookieFile, setCookieFile] = useState<File | null>(null);
  const [cookieInspection, setCookieInspection] = useState<CookieImportInspection | null>(null);
  const [cookieInspecting, setCookieInspecting] = useState(false);

  async function load() {
    try {
      const [profileRows, proxyRows, defaultRows, stateRows, planRows, membershipRows, clientRows, assignmentRows, extensionRows, extensionMembershipRows] = await Promise.all([
        api.profiles.list(),
        api.proxies.list(),
        api.profileProxyDefaults.list(),
        api.profileSessions.list(),
        api.plans.list(),
        api.profilePlans.list(),
        api.clients.list(),
        api.assignments.list(),
        api.extensions.list(),
        api.profileExtensions.list(),
      ]);
      setProfiles(profileRows);
      setProxies(proxyRows);
      setProxyDefaults(defaultRows);
      setSessionStates(stateRows);
      setPlans(planRows);
      setProfilePlanMemberships(membershipRows);
      setClients(clientRows);
      setAssignments(assignmentRows);
      setExtensions(extensionRows);
      setProfileExtensionMemberships(extensionMembershipRows);
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

  function extensionIdsFor(profileId: string) {
    return profileExtensionMemberships
      .filter((item) => item.profile_id === profileId)
      .map((item) => item.extension_id);
  }

  function toggleExtension(extensionId: string) {
    setSelectedExtensionIds((current) => current.includes(extensionId)
      ? current.filter((id) => id !== extensionId)
      : [...current, extensionId]);
  }

  function validationClientsFor(profileId: string) {
    const ids = new Set(
      assignments
        .filter((item) => item.profile_id === profileId && item.enabled && Boolean(item.proxy_id))
        .map((item) => item.client_id),
    );
    return clients.filter((client) => ids.has(client.id) && client.status === 'active');
  }


  function openEditor(value: Exclude<Editor, null>) {
    const current = value === 'new' ? null : value;
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl(current?.image_url || '');
    setProfileUrl(current?.url || '');
    setCookieFile(null);
    setCookieInspection(null);
    const initialAuth = current?.auth_strategy
      || (current?.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
    setBrowserEngine(current?.browser_engine || 'chrome-native');
    setAuthStrategy(initialAuth);
    setStorageStrategy(current?.storage_strategy
      || (initialAuth === 'manual' || initialAuth === 'credential-autofill' ? 'local-persistent' : 'portable-first-party'));
    setNetworkStrategy(current?.network_strategy || 'auto');
    setExtensionStrategy(current?.extension_strategy || (initialAuth === 'manual' ? 'guard-only' : 'custom'));
    setSelectedPlanIds(current ? planIdsFor(current.id) : []);
    setSelectedExtensionIds(current ? extensionIdsFor(current.id) : []);
    setShowLoginUsername(false);
    setShowLoginPassword(false);
    setEditor(value);
    setError(null);
    setSuccess(null);
  }

  function closeEditor() {
    replaceObjectUrl(null);
    setImageFile(null);
    setImageUrl('');
    setProfileUrl('');
    setCookieFile(null);
    setCookieInspection(null);
    setCookieInspecting(false);
    setBrowserEngine('chrome-native');
    setAuthStrategy('manual');
    setStorageStrategy('local-persistent');
    setNetworkStrategy('client-direct');
    setExtensionStrategy('guard-only');
    setSelectedPlanIds([]);
    setSelectedExtensionIds([]);
    setShowLoginUsername(false);
    setShowLoginPassword(false);
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

  async function inspectCookieFile(file: File | null = cookieFile, url = profileUrl) {
    if (!file) return null;
    const targetUrl = url.trim();
    if (!targetUrl) {
      setCookieInspection(null);
      setError('Ingresa primero la URL del perfil para saber qué cookies corresponden a esa web.');
      return null;
    }
    try {
      setCookieInspecting(true);
      setError(null);
      const result = await api.profileSessions.inspectCookies(file, targetUrl);
      setCookieInspection(result.inspection);
      if (result.inspection.matching_cookies < 1) {
        const domains = result.inspection.domains.slice(0, 6).map((item) => item.domain).join(', ');
        setError(
          domains
            ? `El JSON no tiene cookies aplicables a ${result.inspection.target_host}. Contiene: ${domains}.`
            : `El JSON no tiene cookies válidas aplicables a ${result.inspection.target_host}.`,
        );
      }
      return result.inspection;
    } catch (inspectError: any) {
      setCookieInspection(null);
      setError(inspectError.message);
      return null;
    } finally {
      setCookieInspecting(false);
    }
  }

  async function chooseCookieFile(file: File | null) {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.json') && !['application/json', 'text/json', ''].includes(file.type.toLowerCase())) {
      setError('Selecciona un archivo JSON de cookies.');
      return;
    }
    if (file.size < 1 || file.size > MAX_COOKIE_JSON_BYTES) {
      setError('El archivo JSON de cookies no puede superar 8 MB.');
      return;
    }

    setCookieFile(file);
    setCookieInspection(null);
    if (authStrategy === 'manual') setAuthStrategy('cookie-snapshot');
    else if (authStrategy === 'credential-autofill') setAuthStrategy('hybrid');
    setStorageStrategy('cookies-only');
    if (extensionStrategy === 'guard-only') setExtensionStrategy('custom');
    await inspectCookieFile(file, profileUrl);
  }

  function clearCookieFile() {
    setCookieFile(null);
    setCookieInspection(null);
    setError(null);
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
      const credentialsRequired = authStrategy === 'credential-autofill' || authStrategy === 'hybrid';
      if (credentialsRequired) {
        if (!loginUsername) throw new Error('Ingresa el correo o usuario para el autocompletado.');
        if (!currentState?.has_credentials && !loginPassword) throw new Error('Ingresa la contraseña del perfil.');
      }
      if (networkStrategy === 'profile-proxy' && !proxyId) {
        throw new Error('La estrategia Proxy fijo del perfil requiere seleccionar un proxy.');
      }
      if (cookieFile && !['cookie-snapshot', 'hybrid'].includes(authStrategy)) {
        throw new Error('Para importar cookies JSON usa autenticación Snapshot de sesión o Híbrido.');
      }

      const profileUrlValue = String(form.get('url') || '').trim();
      if (cookieFile) {
        const checked = await api.profileSessions.inspectCookies(cookieFile, profileUrlValue);
        setCookieInspection(checked.inspection);
        if (checked.inspection.matching_cookies < 1) {
          const domains = checked.inspection.domains.slice(0, 6).map((item) => item.domain).join(', ');
          throw new Error(
            domains
              ? `Ninguna cookie del archivo corresponde a ${checked.inspection.target_host}. Dominios encontrados: ${domains}.`
              : `Ninguna cookie válida del archivo corresponde a ${checked.inspection.target_host}.`,
          );
        }
      }

      let finalImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        const uploaded = await api.profiles.uploadImage(imageFile);
        finalImageUrl = uploaded.url;
      }

      const input = {
        name: label,
        url: profileUrlValue,
        platform: String(form.get('category') || '').trim() || null,
        image_url: finalImageUrl,
        tags: [label],
        enabled: String(form.get('enabled')) === 'true',
        session_mode: (authStrategy === 'manual' ? 'manual-login' : 'managed-first-party') as SessionMode,
        browser_engine: browserEngine,
        auth_strategy: authStrategy,
        storage_strategy: storageStrategy,
        network_strategy: networkStrategy,
        extension_strategy: extensionStrategy,
      };

      const savedProfile = editor && editor !== 'new'
        ? await api.profiles.update(editor.id, input)
        : await api.profiles.create(input);

      if (editor === 'new') setEditor(savedProfile);
      await api.profilePlans.set(savedProfile.id, selectedPlanIds);
      await api.profileExtensions.set(savedProfile.id, selectedExtensionIds);
      const profileProxyId = networkStrategy === 'profile-proxy' || networkStrategy === 'auto' ? proxyId : null;
      await api.profileProxyDefaults.set(savedProfile.id, profileProxyId);
      const shouldSaveCredentials = authStrategy === 'credential-autofill'
        || authStrategy === 'hybrid'
        || (authStrategy === 'cookie-snapshot' && Boolean(loginUsername));
      if (shouldSaveCredentials) {
        await api.profileSessions.credentials(savedProfile.id, loginUsername, loginPassword || undefined);
      }
      let importedCookies: { version: number; inspection: CookieImportInspection } | null = null;
      if (cookieFile) {
        const imported = await api.profileSessions.importCookies(savedProfile.id, cookieFile);
        importedCookies = {
          version: imported.version,
          inspection: imported.inspection,
        };
      }
      const wasEditing = Boolean(editor && editor !== 'new');
      closeEditor();
      if (importedCookies) {
        const ignored = importedCookies.inspection.ignored_cookies
          + importedCookies.inspection.expired_cookies
          + importedCookies.inspection.invalid_cookies;
        setSuccess(
          `${wasEditing ? 'Perfil actualizado' : 'Perfil creado'} · snapshot v${importedCookies.version} · ${importedCookies.inspection.matching_cookies} cookies de ${importedCookies.inspection.target_host} importadas${ignored ? ` · ${ignored} cookies de otras webs/expiradas/invalidas ignoradas` : ''}.`,
        );
      } else {
        setSuccess(wasEditing ? 'Perfil actualizado correctamente.' : 'Perfil creado correctamente.');
      }
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
      setSuccess(null);
      const result = await api.profileSessions.capture(profile.id);
      setCaptureLaunch({
        profileId: profile.id,
        profileName: profileLabel(profile),
        launchUrl: result.launch_url,
        saveUrl: result.save_url,
        expiresAt: result.expires_at || null,
        baselineVersion: stateFor(profile.id)?.version || 0,
      });
      setCaptureSaveMessage(null);
      setCaptureRetryReady(false);
      launchCustomProtocol(result.launch_url);
      window.setTimeout(() => setCaptureRetryReady(true), 6000);
      window.setTimeout(() => void load(), 2500);
    } catch (captureError: any) {
      setError(captureError.message);
    } finally {
      setSessionAction(null);
    }
  }

  async function retryCapture() {
    if (!captureLaunch || captureRetryInFlight.current) return;
    captureRetryInFlight.current = true;
    try {
      setSessionAction(captureLaunch.profileId);
      setError(null);
      setCaptureRetryReady(false);
      const result = await api.profileSessions.capture(captureLaunch.profileId);
      setCaptureLaunch((current) => current ? {
        ...current,
        launchUrl: result.launch_url,
        saveUrl: result.save_url,
        expiresAt: result.expires_at || null,
        baselineVersion: stateFor(current.profileId)?.version || current.baselineVersion,
      } : current);
      setCaptureSaveMessage(null);
      launchCustomProtocol(result.launch_url);
      window.setTimeout(() => setCaptureRetryReady(true), 6000);
      window.setTimeout(() => void load(), 2500);
    } catch (captureError: any) {
      setError(captureError.message);
      setCaptureRetryReady(true);
    } finally {
      captureRetryInFlight.current = false;
      setSessionAction(null);
    }
  }

  async function saveCaptureFromAdmin() {
    if (!captureLaunch || captureSaveBusy) return;
    try {
      setCaptureSaveBusy(true);
      setError(null);

      // The Chromium overlay may have already completed this same one-use
      // capture. Check the server first so the Admin button is idempotent and
      // does not send a stale Save protocol back to Session Manager.
      const beforeSaveRows = await api.profileSessions.list();
      setSessionStates(beforeSaveRows);
      const alreadySaved = beforeSaveRows.find((item) => item.profile_id === captureLaunch.profileId);
      if (alreadySaved && alreadySaved.status === 'active' && alreadySaved.version > captureLaunch.baselineVersion) {
        setCaptureLaunch((value) => value ? { ...value, baselineVersion: alreadySaved.version } : value);
        setCaptureSaveMessage(
          `Sesión ya guardada correctamente · snapshot v${alreadySaved.version}${alreadySaved.public_ip ? ` · IP ${alreadySaved.public_ip}` : ''}.`,
        );
        setSuccess('Sesión guardada. Session Keeper quedó registrado para mantenerla automáticamente.');
        return;
      }

      setCaptureSaveMessage('Solicitando a Session Manager que capture cookies y almacenamiento...');
      launchCustomProtocol(captureLaunch.saveUrl);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        const rows = await api.profileSessions.list();
        setSessionStates(rows);
        const current = rows.find((item) => item.profile_id === captureLaunch.profileId);
        if (current && current.status === 'active' && current.version > captureLaunch.baselineVersion) {
          setCaptureLaunch((value) => value ? { ...value, baselineVersion: current.version } : value);
          setCaptureSaveMessage(
            `Sesión guardada correctamente · snapshot v${current.version}${current.public_ip ? ` · IP ${current.public_ip}` : ''}.`,
          );
          setSuccess('Sesión guardada. Session Keeper quedó registrado para mantenerla automáticamente.');
          return;
        }
      }

      setCaptureSaveMessage('Session Manager recibió la orden, pero el Administrador todavía no confirmó el nuevo snapshot. Espera unos segundos y pulsa Validar.');
    } catch (saveError: any) {
      setError(saveError.message);
      setCaptureSaveMessage('No se pudo confirmar el guardado de la sesión.');
    } finally {
      setCaptureSaveBusy(false);
    }
  }

  async function clearSession(profile: Profile) {
    if (!confirm(`¿Borrar la sesión guardada de ${profileLabel(profile)}?`)) return;
    try {
      setSessionAction(profile.id);
      setError(null);
      setSuccess(null);
      await api.profileSessions.clear(profile.id);
      setSuccess('Snapshot eliminado correctamente.');
      await load();
    } catch (clearError: any) {
      setError(clearError.message);
    } finally {
      setSessionAction(null);
    }
  }

  async function clearAutofillCredentials(profile: Profile) {
    if (!confirm(`¿Eliminar las credenciales de autofill guardadas de ${profileLabel(profile)}?`)) return;
    try {
      setSessionAction(profile.id);
      setError(null);
      setSuccess(null);
      await api.profileSessions.clearCredentials(profile.id);
      setSuccess('Credenciales de autofill eliminadas correctamente.');
      await load();
    } catch (clearError: any) {
      setError(clearError.message);
    } finally {
      setSessionAction(null);
    }
  }

  async function openValidation(profile: Profile) {
    const eligible = validationClientsFor(profile.id);
    const defaultClientId = profile.network_strategy === 'assigned-proxy' ? (eligible[0]?.id || '') : '';
    setValidationProfile(profile);
    setValidationClientId(defaultClientId);
    setValidationResult(null);
    setValidationJob(null);
    setValidationBusy(true);
    try {
      const response = await api.profileSessions.validate(profile.id, defaultClientId || null);
      setValidationResult(response.validation);
    } catch (validationError: any) {
      setError(validationError.message);
    } finally {
      setValidationBusy(false);
    }
  }

  async function refreshValidation(clientId = validationClientId) {
    if (!validationProfile) return;
    try {
      setValidationBusy(true);
      setError(null);
      const response = await api.profileSessions.validate(validationProfile.id, clientId || null);
      setValidationResult(response.validation);
    } catch (validationError: any) {
      setError(validationError.message);
    } finally {
      setValidationBusy(false);
    }
  }

  async function pollValidationJob(jobId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const response = await api.profileSessions.testStatus(jobId);
        setValidationJob(response.job);
        if (['completed', 'failed', 'expired'].includes(response.job.status)) {
          if (response.job.status === 'completed') await load();
          return;
        }
      } catch {
        return;
      }
    }
  }

  async function startClientTest() {
    if (!validationProfile) return;
    if (validationProfile.network_strategy === 'assigned-proxy' && !validationClientId) {
      setError('Selecciona un cliente para simular su proxy asignado.');
      return;
    }
    try {
      setValidationBusy(true);
      setError(null);
      const response = await api.profileSessions.clientTest(validationProfile.id, validationClientId || null);
      setValidationResult(response.validation);
      setValidationJob({
        id: response.job_id,
        profile_id: validationProfile.id,
        client_id: validationClientId || null,
        status: 'pending',
        result: null,
        error: null,
        expires_at: response.expires_at,
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
      });
      launchCustomProtocol(response.launch_url);
      void pollValidationJob(response.job_id);
    } catch (testError: any) {
      setError(testError.message);
    } finally {
      setValidationBusy(false);
    }
  }


  async function remove(profile: Profile) {
    if (!confirm(`¿Eliminar el perfil ${profileLabel(profile)}?`)) return;
    try {
      setError(null);
      setSuccess(null);
      await api.profiles.remove(profile.id);
      setSuccess('Perfil eliminado correctamente.');
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
      <SuccessBanner message={success} />

      {profiles.length === 0 ? (
        <Card>
          <Empty title="No hay perfiles" description="Agrega la primera web o perfil que quieras administrar." />
        </Card>
      ) : filteredProfiles.length === 0 ? (
        <Card>
          <Empty title="No se encontraron perfiles" description={`No hay coincidencias para “${searchQuery.trim()}”. Prueba con otra parte del nombre, categoría, plan o URL.`} />
        </Card>
      ) : (
        <div className="profile-list">
          {filteredProfiles.map((profile) => {
            const selectedProxy = proxies.find((proxy) => proxy.id === defaultProxyId(profile.id));
            const session = stateFor(profile.id);
            const profileAuth = profile.auth_strategy
              || (profile.session_mode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
            const snapshotManaged = profileAuth === 'cookie-snapshot' || profileAuth === 'hybrid';
            const credentialManaged = profileAuth === 'credential-autofill' || profileAuth === 'hybrid';
            const credentialHelperConfigured = session?.has_credentials === true;
            const credentialHelperSupported = credentialManaged || profileAuth === 'cookie-snapshot';
            const managed = profileAuth !== 'manual';
            const profilePlanIds = planIdsFor(profile.id);
            const profilePlans = plans.filter((plan) => profilePlanIds.includes(plan.id));
            const profileBrowser = (profile.browser_engine || 'chrome-native') as BrowserEngine;
            const profileStorage = (profile.storage_strategy
              || (profileAuth === 'manual' || profileAuth === 'credential-autofill' ? 'local-persistent' : 'portable-first-party')) as StorageStrategy;
            const profileNetwork = (profile.network_strategy || 'auto') as NetworkStrategy;
            const profileExtension = (profile.extension_strategy
              || (profileAuth === 'manual' ? 'guard-only' : 'custom')) as ExtensionStrategy;
            const expanded = expandedProfileId === profile.id;
            return (
              <Card className={`profile-card profile-card-compact${expanded ? ' expanded' : ''}`} key={profile.id}>
                <div className="profile-compact-row">
                  <div className="profile-compact-identity">
                    <div className="profile-image profile-image-compact">
                      {profile.image_url ? (
                        <img src={profile.image_url} alt={`Logo de ${profileLabel(profile)}`} referrerPolicy="no-referrer" />
                      ) : (
                        <Globe2 size={24} />
                      )}
                    </div>
                    <div className="profile-compact-title">
                      <div className="profile-title-row">
                        <h3>{profileLabel(profile)}</h3>
                        <Badge tone={profile.enabled ? 'ok' : 'bad'}>{profile.enabled ? 'Activo' : 'Inactivo'}</Badge>
                      </div>
                      <div className="profile-compact-meta">
                        <Badge tone={profile.platform ? 'neutral' : 'warn'}>{profile.platform || 'Sin categoría'}</Badge>
                        <Badge tone={profilePlanIds.length > 0 ? 'neutral' : 'warn'}>
                          {profilePlanIds.length === 0
                            ? 'Sin plan'
                            : `${profilePlanIds.length} ${profilePlanIds.length === 1 ? 'plan' : 'planes'}`}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="profile-compact-summary">
                    <Badge tone="neutral">Auth: {AUTH_STRATEGY_LABEL[profileAuth]}</Badge>
                    <Badge tone="neutral">Red: {NETWORK_STRATEGY_LABEL[profileNetwork]}</Badge>
                    {snapshotManaged && (() => {
                      const snapshot = snapshotBadge(session);
                      return <Badge tone={snapshot.tone}>{snapshot.compact}</Badge>;
                    })()}
                    {snapshotManaged && (() => {
                      const keeper = keeperBadge(session);
                      return <Badge tone={keeper.tone}>{keeper.compact}</Badge>;
                    })()}
                    {selectedProxy ? (
                      <Badge tone={selectedProxy.enabled ? 'neutral' : 'warn'}>Proxy: {selectedProxy.name}</Badge>
                    ) : (
                      <Badge tone={profileNetwork === 'profile-proxy' ? 'bad' : 'neutral'}>
                        {profileNetwork === 'assigned-proxy' ? 'Proxy por cliente' : profileNetwork === 'client-direct' ? 'Sin proxy' : 'Proxy auto'}
                      </Badge>
                    )}
                  </div>

                  <div className="profile-compact-actions">
                    {snapshotManaged && (
                      <button
                        className="profile-icon-action"
                        disabled={sessionAction === profile.id}
                        onClick={() => void startCapture(profile)}
                        title={session?.status === 'active' ? 'Renovar snapshot' : 'Capturar sesión'}
                        aria-label={session?.status === 'active' ? 'Renovar snapshot' : 'Capturar sesión'}
                      >
                        {session?.status === 'active' ? <RefreshCw size={15} /> : <KeyRound size={15} />}
                      </button>
                    )}
                    <button
                      className="profile-icon-action"
                      onClick={() => void openValidation(profile)}
                      title="Validar configuración"
                      aria-label="Validar configuración"
                    >
                      <ShieldCheck size={15} />
                    </button>
                    <button
                      className="profile-icon-action"
                      onClick={() => openEditor(profile)}
                      title="Editar perfil"
                      aria-label="Editar perfil"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="profile-details-toggle"
                      onClick={() => setExpandedProfileId(expanded ? null : profile.id)}
                      aria-expanded={expanded}
                      title={expanded ? 'Ocultar detalles' : 'Ver configuración completa'}
                    >
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span>{expanded ? 'Cerrar' : 'Detalles'}</span>
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="profile-expanded-details">
                    <div className="profile-expanded-head">
                      <a className="profile-url" href={profile.url} target="_blank" rel="noreferrer">{profile.url}</a>
                      <div className="profile-plan-inline">
                        <span className="profile-plan-label">Planes:</span>
                        <span className="profile-plan-value">
                          {profilePlans.length > 0 ? profilePlans.map((plan) => plan.name).join(' · ') : 'Sin planes asignados'}
                        </span>
                      </div>
                    </div>

                    <div className="profile-config-grid">
                      <section className="profile-config-section">
                        <div className="profile-config-title">Acceso</div>
                        <div className="profile-config-items">
                          <Badge tone="neutral">Auth: {AUTH_STRATEGY_LABEL[profileAuth]}</Badge>
                          {snapshotManaged && (() => {
                            const snapshot = snapshotBadge(session);
                            return <Badge tone={snapshot.tone}>{snapshot.detail}</Badge>;
                          })()}
                          {snapshotManaged && (() => {
                            const keeper = keeperBadge(session);
                            return <Badge tone={keeper.tone}>{keeper.detail}</Badge>;
                          })()}
                          {credentialHelperSupported && (
                            <Badge tone={credentialHelperConfigured ? 'ok' : credentialManaged ? 'bad' : 'warn'}>
                              {profileAuth === 'cookie-snapshot'
                                ? `Autofill: ${credentialHelperConfigured ? 'respaldo listo' : 'sin configurar'}`
                                : `Credenciales: ${credentialHelperConfigured ? 'listas' : 'faltan'}`}
                            </Badge>
                          )}
                        </div>
                      </section>

                      <section className="profile-config-section">
                        <div className="profile-config-title">Red</div>
                        <div className="profile-config-items">
                          <Badge tone="neutral">Red: {NETWORK_STRATEGY_LABEL[profileNetwork]}</Badge>
                          {selectedProxy ? (
                            <Badge tone={selectedProxy.enabled ? 'neutral' : 'warn'}>
                              Proxy: {selectedProxy.name}{selectedProxy.enabled ? '' : ' · inactivo'}
                            </Badge>
                          ) : (
                            <Badge tone={profileNetwork === 'profile-proxy' ? 'bad' : 'neutral'}>
                              {profileNetwork === 'assigned-proxy'
                                ? 'Proxy: asignado por cliente'
                                : profileNetwork === 'client-direct'
                                  ? 'Proxy: no usado'
                                  : profileNetwork === 'profile-proxy'
                                    ? 'Proxy: falta configurar'
                                    : 'Proxy: sin valor por defecto'}
                            </Badge>
                          )}
                          {managed && session?.public_ip && <Badge>IP: {session.public_ip}</Badge>}
                        </div>
                      </section>

                      <section className="profile-config-section">
                        <div className="profile-config-title">Entorno</div>
                        <div className="profile-config-items">
                          <Badge tone="neutral">Motor: {BROWSER_ENGINE_LABEL[profileBrowser]}</Badge>
                          <Badge tone="neutral">Storage: {STORAGE_STRATEGY_LABEL[profileStorage]}</Badge>
                          <Badge tone="neutral">Extensión: {EXTENSION_STRATEGY_LABEL[profileExtension]}</Badge>
                        </div>
                      </section>
                    </div>

                    <div className="profile-card-footer">
                      <div className="profile-session-actions">
                        {snapshotManaged && (
                          <>
                            <button className="button secondary small" disabled={sessionAction === profile.id} onClick={() => void startCapture(profile)}>
                              {session?.status === 'active' ? <RefreshCw size={12} /> : <KeyRound size={12} />}
                              {session?.status === 'active' ? 'Renovar snapshot' : 'Capturar sesión'}
                            </button>
                            {session?.status === 'active' && (
                              <button className="button danger small" disabled={sessionAction === profile.id} onClick={() => void clearSession(profile)}>
                                Borrar snapshot
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      <div className="profile-actions">
                        <button className="button secondary small" onClick={() => void openValidation(profile)}>
                          <ShieldCheck size={12} />
                          Validar
                        </button>
                        {credentialHelperSupported && (
                          <button
                            className="button secondary small"
                            onClick={() => void openValidation(profile)}
                            title={credentialHelperConfigured ? 'Comprueba el helper Email/Password con userFLOW' : 'Guarda credenciales primero para probar autofill'}
                          >
                            <KeyRound size={12} />
                            Probar autofill
                          </button>
                        )}
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
                )}
              </Card>
            );
          })}
        </div>
      )}

      {validationProfile && (
        <Modal
          title={`Validación · ${profileLabel(validationProfile)}`}
          error={error}
          onClose={() => {
            setValidationProfile(null);
            setValidationResult(null);
            setValidationJob(null);
          }}
          actions={
            <button
              className="button secondary"
              onClick={() => {
                setValidationProfile(null);
                setValidationResult(null);
                setValidationJob(null);
              }}
            >
              Cerrar
            </button>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ padding: 14, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12 }}>
              <strong>La prueba real se ejecuta con userFLOW.</strong>
              <div className="help" style={{ marginTop: 6 }}>
                El servidor primero valida configuración. Después “Probar como cliente” abre un perfil temporal en el userFLOW instalado y usa el mismo motor, cookies, autofill y red que recibirá un cliente real. El perfil temporal se elimina al cerrar ese navegador.
              </div>
            </div>

            {(validationProfile.auth_strategy === 'cookie-snapshot'
              || validationProfile.auth_strategy === 'credential-autofill'
              || validationProfile.auth_strategy === 'hybrid'
              || validationProfile.session_mode === 'managed-first-party') && (
              <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12, display: 'grid', gap: 8 }}>
                <div className="toolbar" style={{ margin: 0 }}>
                  <strong>Autofill de credenciales</strong>
                  <Badge tone={stateFor(validationProfile.id)?.has_credentials ? 'ok' : 'warn'}>
                    {stateFor(validationProfile.id)?.has_credentials ? 'Configurado' : 'Sin credenciales'}
                  </Badge>
                </div>
                <div className="help">
                  {stateFor(validationProfile.id)?.has_credentials
                    ? 'userFLOW recibirá estas credenciales temporalmente y probará el helper visible Email / Password en el dominio del perfil. La contraseña permanece cifrada en el backend y no se guarda en el resultado.'
                    : 'Este perfil no tiene credenciales de autofill guardadas. Puedes seguir usando el snapshot, pero no habrá respaldo automático si la web vuelve a pedir login.'}
                </div>
                {!stateFor(validationProfile.id)?.has_credentials && (
                  <button className="button secondary small" onClick={() => openEditor(validationProfile)}>
                    <KeyRound size={12} />
                    Configurar autofill
                  </button>
                )}
              </div>
            )}

            {validationProfile.network_strategy === 'assigned-proxy' && (
              <Field label="Cliente a simular" help="Se usará exactamente el proxy asignado a este cliente para este perfil.">
                <select
                  className="select"
                  value={validationClientId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValidationClientId(value);
                    setValidationJob(null);
                    void refreshValidation(value);
                  }}
                >
                  <option value="">Selecciona un cliente</option>
                  {validationClientsFor(validationProfile.id).map((client) => (
                    <option value={client.id} key={client.id}>{client.name} · {client.email}</option>
                  ))}
                </select>
              </Field>
            )}

            <div className="toolbar" style={{ margin: 0 }}>
              <button
                className="button secondary"
                disabled={validationBusy}
                onClick={() => void refreshValidation()}
              >
                <RefreshCw size={14} />
                {validationBusy ? 'Validando...' : 'Validar configuración'}
              </button>
              <button
                className="button primary"
                disabled={validationBusy || !validationResult?.ready}
                onClick={() => void startClientTest()}
              >
                <Globe2 size={14} />
                Probar en userFLOW
              </button>
            </div>

            {validationResult && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="toolbar" style={{ margin: 0 }}>
                  <Badge tone={validationResult.ready ? 'ok' : 'bad'}>
                    {validationResult.ready ? 'Configuración lista' : 'Configuración bloqueada'}
                  </Badge>
                  <Badge tone="neutral">Red: {validationResult.network.source}</Badge>
                  {validationResult.network.publicIp && <Badge>IP: {validationResult.network.publicIp}</Badge>}
                </div>
                {validationResult.checks.map((check) => (
                  <div
                    key={check.key}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}
                  >
                    <Badge tone={check.status === 'pass' ? 'ok' : check.status === 'warn' ? 'warn' : 'bad'}>
                      {check.status === 'pass' ? 'OK' : check.status === 'warn' ? 'Aviso' : 'Error'}
                    </Badge>
                    <div>
                      <div className="table-primary">{check.label}</div>
                      <div className="help">{check.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {validationJob && (
              <div style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 12, display: 'grid', gap: 8 }}>
                <div className="toolbar" style={{ margin: 0 }}>
                  <strong>Prueba userFLOW</strong>
                  <Badge tone={validationJob.status === 'completed' ? 'ok' : validationJob.status === 'failed' || validationJob.status === 'expired' ? 'bad' : 'warn'}>
                    {validationJob.status}
                  </Badge>
                </div>
                {validationJob.status === 'pending' && <div className="help">Esperando que Windows abra userFLOW...</div>}
                {validationJob.status === 'running' && <div className="help">userFLOW está ejecutando el perfil temporal con la configuración real.</div>}
                {validationJob.error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{validationJob.error}</div>}
                {validationJob.result && (
                  <div style={{ display: 'grid', gap: 5, fontSize: 12 }}>
                    <div><b>Resultado:</b> {String(validationJob.result.outcome || 'sin detalle')}</div>
                    <div><b>Navegador:</b> {String(validationJob.result.browser || 'desconocido')}</div>
                    <div><b>Estado:</b> {String(validationJob.result.profileState || 'desconocido')}</div>
                    {validationJob.result.publicIp && <div><b>IP detectada:</b> {String(validationJob.result.publicIp)}</div>}
                    {validationJob.result.inspection && (
                      <>
                        <div><b>URL final:</b> {String(validationJob.result.inspection.currentUrl || '')}</div>
                        <div>
                          <b>Autofill 0.3.14:</b>{' '}
                          {validationJob.result.inspection.helperVisible ? 'helper visible' : 'helper NO visible'}
                          {' · '}
                          {validationJob.result.inspection.usernameFilled ? 'email completado' : 'email NO completado'}
                          {' · '}
                          {validationJob.result.inspection.passwordFilled ? 'password completado' : 'password pendiente/no visible'}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {['pending', 'running'].includes(validationJob.status) && (
                  <button className="button secondary small" onClick={() => void pollValidationJob(validationJob.id)}>
                    Actualizar resultado
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {editor && (
        <Modal
          title={current ? `Editar perfil · ${profileLabel(current)}` : 'Nuevo perfil / web'}
          error={error}
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
              <input
                className="input"
                name="url"
                type="url"
                value={profileUrl}
                onChange={(event) => {
                  setProfileUrl(event.target.value);
                  setCookieInspection(null);
                }}
                onBlur={() => {
                  if (cookieFile && !cookieInspecting) void inspectCookieFile(cookieFile, profileUrl);
                }}
                required
                placeholder="https://..."
              />
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
              label="Motor de navegador"
              tooltip="Define qué navegador abrirá este perfil. Pasa el cursor sobre cada opción para ver qué implica."
            >
              <select
                className="select"
                value={browserEngine}
                title={BROWSER_ENGINE_HELP[browserEngine]}
                onChange={(event) => setBrowserEngine(event.target.value as BrowserEngine)}
              >
                <option value="chrome-native" title={BROWSER_ENGINE_HELP['chrome-native']}>Chrome nativo / Chrome instalado</option>
                <option value="nstchrome" title={BROWSER_ENGINE_HELP.nstchrome}>nstchrome · requiere runtime autorizado empaquetado</option>
              </select>
            </Field>

            <Field
              label="Estrategia de extensión"
              tooltip="Define el nivel de protección y las adaptaciones del Browser Guard. GOOGLE añade reglas específicas para el flujo de acceso de Google."
            >
              <select
                className="select"
                value={extensionStrategy}
                title={EXTENSION_STRATEGY_HELP[extensionStrategy]}
                onChange={(event) => setExtensionStrategy(event.target.value as ExtensionStrategy)}
              >
                <option value="guard-only" title={EXTENSION_STRATEGY_HELP['guard-only']}>Guard only</option>
                <option value="main" title={EXTENSION_STRATEGY_HELP.main}>MAIN</option>
                <option value="google" title={EXTENSION_STRATEGY_HELP.google}>GOOGLE</option>
                <option value="custom" title={EXTENSION_STRATEGY_HELP.custom}>CUSTOM</option>
              </select>
            </Field>

            <Field
              label={`Extensiones del perfil (${extensions.filter((item) => item.scope === 'global' && item.enabled && item.validation_status === 'runtime_valid').length + selectedExtensionIds.length})`}
              className="span-2"
              tooltip="Browser Guard siempre se carga aparte. Las extensiones globales vienen del panel Extensiones; aquí eliges las extensiones verificadas que solo deben aplicarse a este perfil."
              help="Solo aparecen seleccionables las extensiones que ya pasaron la prueba real en userFLOW. Las globales están marcadas y no se pueden quitar desde este perfil."
            >
              <div className="managed-extension-picker">
                <div className="managed-extension-system-row">
                  <div>
                    <div className="table-primary"><ShieldCheck size={13} /> Browser Guard</div>
                    <div className="table-secondary">Sistema · obligatorio · estrategia {EXTENSION_STRATEGY_LABEL[extensionStrategy]}</div>
                  </div>
                  <Badge tone="ok">Siempre activo</Badge>
                </div>

                {extensions.filter((item) => item.scope === 'global').map((item) => {
                  const ready = item.enabled && item.validation_status === 'runtime_valid';
                  return (
                    <label className={`managed-extension-option global ${ready ? '' : 'disabled'}`} key={item.id}>
                      <input type="checkbox" checked={ready} disabled />
                      <span className="managed-extension-option-body">
                        <span className="table-primary"><Puzzle size={13} /> {item.name} <small>v{item.version}</small></span>
                        <span className="table-secondary">
                          Global · {item.validation_status === 'runtime_valid' ? (item.enabled ? 'activa' : 'desactivada') : item.validation_status}
                        </span>
                      </span>
                      <Badge tone={ready ? 'ok' : item.validation_status === 'error' || item.validation_status === 'incompatible' ? 'bad' : 'warn'}>
                        {ready ? 'Global' : 'No disponible'}
                      </Badge>
                    </label>
                  );
                })}

                {extensions.filter((item) => item.scope === 'selective').map((item) => {
                  const selectable = item.validation_status === 'runtime_valid';
                  const selected = selectedExtensionIds.includes(item.id);
                  return (
                    <label className={`managed-extension-option ${selectable ? '' : 'disabled'}`} key={item.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selectable}
                        onChange={() => toggleExtension(item.id)}
                      />
                      <span className="managed-extension-option-body">
                        <span className="table-primary"><Puzzle size={13} /> {item.name} <small>v{item.version}</small></span>
                        <span className="table-secondary">
                          {selectable
                            ? (item.enabled ? 'Verificada · disponible' : 'Verificada · se activará al habilitarla en Extensiones')
                            : item.validation_message || 'Primero valida esta extensión en userFLOW.'}
                        </span>
                      </span>
                      <Badge tone={selectable ? 'ok' : item.validation_status === 'error' || item.validation_status === 'incompatible' ? 'bad' : 'warn'}>
                        {selectable ? 'Verificada' : item.validation_status}
                      </Badge>
                    </label>
                  );
                })}

                {extensions.length === 0 && (
                  <div className="help">Todavía no hay extensiones cargadas. Agrégalas y valídalas desde Administración → Extensiones.</div>
                )}
              </div>
            </Field>

            <Field
              label="Autenticación"
              className="span-2"
              tooltip="Define cómo entra el perfil a la cuenta: manualmente, restaurando una sesión, usando autofill o combinando snapshot + credenciales."
            >
              <select className="select" value={authStrategy} title={AUTH_STRATEGY_HELP[authStrategy]} onChange={(event) => {
                const value = event.target.value as AuthStrategy;
                setAuthStrategy(value);
                if (value === 'manual' || value === 'credential-autofill') setStorageStrategy('local-persistent');
                else if (storageStrategy === 'local-persistent') setStorageStrategy('portable-first-party');
                if (value === 'manual') setExtensionStrategy('guard-only');
                else if (extensionStrategy === 'guard-only') setExtensionStrategy('custom');
              }}>
                <option value="manual" title={AUTH_STRATEGY_HELP.manual}>Login manual / estado local persistente</option>
                <option value="cookie-snapshot" title={AUTH_STRATEGY_HELP['cookie-snapshot']}>Snapshot de cookies/sesión</option>
                <option value="credential-autofill" title={AUTH_STRATEGY_HELP['credential-autofill']}>Autocompletado de credenciales</option>
                <option value="hybrid" title={AUTH_STRATEGY_HELP.hybrid}>Híbrido: snapshot + credenciales</option>
              </select>
            </Field>

            <Field
              label="Persistencia / storage"
              tooltip="Define qué datos de la sesión se conservan o restauran. Un snapshot completo incluye más que las cookies."
            >
              <select
                className="select"
                value={storageStrategy}
                title={STORAGE_STRATEGY_HELP[storageStrategy]}
                onChange={(event) => setStorageStrategy(event.target.value as StorageStrategy)}
              >
                <option value="local-persistent" title={STORAGE_STRATEGY_HELP['local-persistent']}>Solo estado persistente del cliente</option>
                <option value="cookies-only" title={STORAGE_STRATEGY_HELP['cookies-only']}>Importar solo cookies</option>
                <option value="portable-first-party" title={STORAGE_STRATEGY_HELP['portable-first-party']}>Cookies + Local/Session Storage + IndexedDB</option>
                <option value="netflix-local-device" title={STORAGE_STRATEGY_HELP['netflix-local-device']}>Netflix: cookies + storage local del dispositivo</option>
              </select>
            </Field>

            <Field
              label="Cookies desde archivo JSON (opcional)"
              className="span-2"
              tooltip="Puedes usar un archivo que contenga cookies de una o varias páginas. userFLEX nunca mezcla todas las páginas: filtra por el dominio de la URL del perfil."
              help="Formatos compatibles: arreglo JSON de cookies, { cookies: [...] }, Playwright storageState y exportaciones comunes de Cookie-Editor/Chrome. Al elegir un archivo se configura Snapshot + Solo cookies."
            >
              <div className="cookie-import-box">
                <div className="cookie-import-head">
                  <div>
                    <div className="table-primary">Importar cookies existentes</div>
                    <div className="table-secondary">
                      Si el JSON contiene varias webs, solo se guardan las cookies que realmente aplican a {profileUrl ? (() => { try { return new URL(profileUrl).hostname; } catch { return 'la URL del perfil'; } })() : 'la URL del perfil'}.
                    </div>
                  </div>
                  <div className="cookie-import-actions">
                    <label className="button secondary small" style={{ cursor: 'pointer' }}>
                      <Upload size={12} /> {cookieFile ? 'Cambiar JSON' : 'Elegir JSON'}
                      <input
                        type="file"
                        accept=".json,application/json,text/json"
                        hidden
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] || null;
                          event.currentTarget.value = '';
                          if (file) void chooseCookieFile(file);
                        }}
                      />
                    </label>
                    {cookieFile && (
                      <button type="button" className="button secondary small" onClick={clearCookieFile}>
                        Quitar
                      </button>
                    )}
                  </div>
                </div>

                {cookieFile && (
                  <div className="cookie-import-file">
                    <span><strong>{cookieFile.name}</strong> · {(cookieFile.size / 1024).toFixed(cookieFile.size >= 1024 * 1024 ? 0 : 1)} KB</span>
                    {cookieInspecting && <Badge tone="warn">Analizando...</Badge>}
                  </div>
                )}

                {cookieInspection && (
                  <div className="cookie-import-inspection">
                    <div className="cookie-import-stats">
                      <span><b>{cookieInspection.total_cookies}</b> en el archivo</span>
                      <span className={cookieInspection.matching_cookies > 0 ? 'ok' : 'bad'}>
                        <b>{cookieInspection.matching_cookies}</b> se usarán para {cookieInspection.target_host}
                      </span>
                      <span><b>{cookieInspection.ignored_cookies}</b> de otras webs</span>
                      <span><b>{cookieInspection.expired_cookies}</b> expiradas</span>
                      <span><b>{cookieInspection.invalid_cookies}</b> inválidas</span>
                    </div>
                    <div className="cookie-domain-list">
                      {cookieInspection.domains.slice(0, 12).map((domain) => (
                        <span className={domain.matchesProfile ? 'match' : ''} key={domain.domain}>
                          {domain.domain} · {domain.count}
                          {domain.matchesProfile ? ' ✓' : ''}
                        </span>
                      ))}
                      {cookieInspection.domains.length > 12 && <span>+{cookieInspection.domains.length - 12} dominios</span>}
                    </div>
                    <div className="help">
                      {cookieInspection.matching_cookies > 0
                        ? `Al guardar se creará/reemplazará el snapshot usando únicamente las ${cookieInspection.matching_cookies} cookies compatibles con ${cookieInspection.target_host}. No se guardarán cookies de los demás dominios.`
                        : 'Este archivo no sirve para la URL actual del perfil. Cambia la URL o usa otro JSON.'}
                    </div>
                  </div>
                )}

                {current && currentState?.status === 'active' && cookieFile && (
                  <div className="help">Este archivo reemplazará el snapshot de cookies actual cuando guardes el perfil.</div>
                )}
              </div>
            </Field>

            <Field
              label="Estrategia de red"
              tooltip="Define por qué conexión e IP saldrá este perfil. Si eliges un proxy fijo, userFLEX puede bloquear la navegación cuando el proxy falla para evitar fugas de IP."
            >
              <select
                className="select"
                value={networkStrategy}
                title={NETWORK_STRATEGY_HELP[networkStrategy]}
                onChange={(event) => setNetworkStrategy(event.target.value as NetworkStrategy)}
              >
                <option value="client-direct" title={NETWORK_STRATEGY_HELP['client-direct']}>IP local/pública del cliente</option>
                <option value="profile-proxy" title={NETWORK_STRATEGY_HELP['profile-proxy']}>Proxy fijo del perfil</option>
                <option value="assigned-proxy" title={NETWORK_STRATEGY_HELP['assigned-proxy']}>Proxy asignado por cliente</option>
                <option value="auto" title={NETWORK_STRATEGY_HELP.auto}>Automático / compatibilidad</option>
              </select>
            </Field>

            {(networkStrategy === 'profile-proxy' || networkStrategy === 'auto') && (
              <Field
                label={networkStrategy === 'profile-proxy' ? 'Proxy fijo del perfil' : 'Proxy por defecto (opcional)'}
                className="span-2"
                tooltip={networkStrategy === 'profile-proxy'
                  ? 'Selecciona el proxy concreto que utilizará siempre este perfil. Si deja de responder, el perfil no debe salir directamente por la IP del cliente.'
                  : 'Selecciona el proxy que userFLEX puede usar como valor por defecto cuando el modo Automático lo requiera.'}
                help={networkStrategy === 'profile-proxy'
                  ? 'Obligatorio. El perfil falla cerrado si este proxy no está disponible.'
                  : 'Compatibilidad: perfiles administrados usan este proxy; perfiles manuales pueden usar asignación o este valor.'}
              >
                <select className="select" name="proxyId" defaultValue={currentProxyId || ''} title="Selecciona el proxy concreto que se usará como salida de red para este perfil.">
                  <option value="" title="No se configura un proxy por defecto para este perfil.">Sin proxy configurado</option>
                  {proxies.map((proxy) => (
                    <option
                      value={proxy.id}
                      key={proxy.id}
                      title={`Usar ${proxy.name} (${proxy.host}:${proxy.port}) como proxy de este perfil${proxy.enabled ? '.' : '. Actualmente está inactivo.'}`}
                    >
                      {proxy.name} · {proxy.host}:{proxy.port}{proxy.enabled ? '' : ' · inactivo'}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {authStrategy !== 'manual' && (
              <>
                <div className="span-2" style={{ padding: 12, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12, display: 'flex', gap: 10 }}>
                  <ShieldCheck size={18} />
                  <div className="help">
                    {authStrategy === 'cookie-snapshot'
                      ? 'El snapshot sigue siendo el método principal. Si guardas credenciales, userFLOW las usa como respaldo de autofill cuando la web vuelve a pedir login; también pueden ayudar durante la captura. La contraseña permanece cifrada en el backend.'
                      : authStrategy === 'credential-autofill'
                        ? 'Las credenciales se entregan temporalmente al motor autorizado para completar Email/Password solo en el dominio del perfil o en un proveedor de autenticación autorizado, como accounts.google.com. No se pulsa automáticamente Enviar/Iniciar sesión.'
                        : 'El modo híbrido exige snapshot y credenciales: restaura la sesión y mantiene autofill de respaldo si la web vuelve a pedir autenticación.'}
                  </div>
                </div>
                <Field label={authStrategy === 'cookie-snapshot' ? 'Correo / usuario para autofill (opcional)' : 'Correo / usuario'} className="span-2">
                  <div className="credential-input-wrap">
                    <input
                      className="input credential-input"
                      name="loginUsername"
                      type={showLoginUsername ? 'text' : 'password'}
                      autoComplete="off"
                      defaultValue={currentState?.login_username || ''}
                      required={authStrategy === 'credential-autofill' || authStrategy === 'hybrid'}
                      placeholder="correo@dominio.com"
                    />
                    <button
                      type="button"
                      className="credential-visibility-toggle"
                      onClick={() => setShowLoginUsername((value) => !value)}
                      aria-label={showLoginUsername ? 'Ocultar correo o usuario' : 'Ver correo o usuario'}
                      title={showLoginUsername ? 'Ocultar' : 'Ver'}
                    >
                      {showLoginUsername ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <Field
                  label={authStrategy === 'cookie-snapshot' ? 'Contraseña para autofill (opcional)' : 'Contraseña'}
                  className="span-2"
                  help={currentState?.has_credentials
                    ? 'Autofill ya está configurado. Déjala vacía para conservar la contraseña cifrada actual.'
                    : 'Se guarda cifrada en el backend y solo se entrega temporalmente al motor autorizado.'}
                >
                  <div className="credential-input-wrap">
                    <input
                      className="input credential-input"
                      name="loginPassword"
                      type={showLoginPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required={(authStrategy === 'credential-autofill' || authStrategy === 'hybrid') && !currentState?.has_credentials}
                      placeholder={currentState?.has_credentials ? '•••••••• (sin cambios)' : 'Contraseña de la cuenta'}
                    />
                    <button
                      type="button"
                      className="credential-visibility-toggle"
                      onClick={() => setShowLoginPassword((value) => !value)}
                      aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      title={showLoginPassword ? 'Ocultar' : 'Ver'}
                    >
                      {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                {current && currentState?.has_credentials && authStrategy === 'cookie-snapshot' && (
                  <div className="span-2">
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={sessionAction === current.id}
                      onClick={() => void clearAutofillCredentials(current)}
                    >
                      <KeyRound size={12} />
                      Eliminar credenciales de autofill guardadas
                    </button>
                    <div className="help" style={{ marginTop: 6 }}>
                      Elimina solo correo/contraseña administrados. No borra el snapshot de cookies ni el perfil local del cliente.
                    </div>
                  </div>
                )}
              </>
            )}

            <Field label="Estado" tooltip="Activo permite usar y asignar el perfil. Inactivo lo conserva configurado, pero evita su uso normal hasta volver a activarlo.">
              <select className="select" name="enabled" defaultValue={current?.enabled === false ? 'false' : 'true'} title="Define si este perfil está disponible para uso normal.">
                <option value="true" title="El perfil queda disponible para los planes y clientes que lo tengan asignado.">Activo</option>
                <option value="false" title="El perfil se conserva, pero queda deshabilitado hasta que lo vuelvas a activar.">Inactivo</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}

      {captureLaunch && (
        <Modal
          title={`Abrir Chromium · ${captureLaunch.profileName}`}
          error={error}
          onClose={() => setCaptureLaunch(null)}
          actions={<button className="button secondary" onClick={() => setCaptureLaunch(null)}>Cerrar</button>}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ padding: 14, border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12 }}>
              <strong>userFLEX intentó abrir el Chromium automáticamente.</strong>
              <div className="help" style={{ marginTop: 6 }}>
                El ticket de captura es de un solo uso. Espera unos segundos mientras Session Manager abre Chromium.
                Si no se abre, usa el botón de reintento: generará un ticket nuevo en el servidor antes de volver a abrir la aplicación.
              </div>
            </div>
            <button
              className="button primary"
              disabled={captureSaveBusy || sessionAction === captureLaunch.profileId}
              onClick={() => void saveCaptureFromAdmin()}
            >
              <ShieldCheck size={14} />
              {captureSaveBusy ? 'Guardando cookies y sesión...' : 'Guardar sesión / generar snapshot'}
            </button>
            {captureSaveMessage && (
              <div style={{ padding: 12, border: '1px solid #d1fae5', background: '#ecfdf5', borderRadius: 10 }}>
                <strong>{captureSaveMessage}</strong>
              </div>
            )}
            <button
              className="button secondary"
              disabled={!captureRetryReady || sessionAction === captureLaunch.profileId}
              onClick={() => void retryCapture()}
            >
              <Globe2 size={14} />
              {!captureRetryReady ? 'Esperando apertura de Chromium...' : 'No se abrió: generar enlace nuevo'}
            </button>
            <a className="button secondary" href={SESSION_MANAGER_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              Instalar / actualizar Session Manager v0.3.31 · userFLOW v0.3.31
            </a>
            <div className="help">
              Completa el inicio de sesión, 2FA o CAPTCHA en Chromium y, cuando ya estés dentro de la cuenta, puedes guardar desde aquí o desde el panel flotante de Chromium.
              Si una de las dos opciones ya guardó el snapshot, la otra lo detectará sin generar un error de ticket. La captura incluye cookies, Local Storage, Session Storage e IndexedDB.
              El enlace es temporal{captureLaunch.expiresAt ? ` y vence a las ${new Date(captureLaunch.expiresAt).toLocaleTimeString()}` : ''}.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
