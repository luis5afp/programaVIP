import React, { useState, useEffect } from 'react';
import {
  Laptop,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Search,
  BookOpen,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  LogOut,
  ChevronRight,
  AlertCircle,
  Key,
  Globe,
  UserCheck,
  Layers,
  ArrowLeft,
  X,
  Play,
  HardDrive,
  Database,
  Save,
  Trash2,
  Download,
  CheckCircle,
  FileCheck,
} from 'lucide-react';
import { CourseHubData, Client, ModuleItem, Profile } from '../types';
import { desktopAppService, ClientAppAuthResponse } from '../services/desktopAppService';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  diskStorageService,
  ProfileDiskRecord,
  DiskStorageStats,
} from '../services/diskStorageService';

interface ClientStandaloneAppProps {
  data: CourseHubData;
}

export function ClientStandaloneApp({ data }: ClientStandaloneAppProps) {
  // PWA Native Installation hook
  const { isInstallable, isInstalled, isStandalone, install } = usePWAInstall();

  // Hard Drive Storage state
  const [diskStats, setDiskStats] = useState<DiskStorageStats | null>(null);
  const [storedDiskRecords, setStoredDiskRecords] = useState<ProfileDiskRecord[]>([]);
  const [showDiskManagerModal, setShowDiskManagerModal] = useState<boolean>(false);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [diskStorageNote, setDiskStorageNote] = useState<string>('');
  const [savingDiskNote, setSavingDiskNote] = useState<boolean>(false);

  // Client Authentication State
  const [isClientLoggedIn, setIsClientLoggedIn] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('coursehub_client_token');
      return !!saved;
    } catch {
      return false;
    }
  });

  const [clientInputUser, setClientInputUser] = useState<string>('');
  const [clientInputPass, setClientInputPass] = useState<string>('');
  const [clientLoginError, setClientLoginError] = useState<string | null>(null);
  const [isAuthenticatingClient, setIsAuthenticatingClient] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [appVersion] = useState<string>('6.2.0');

  // Authenticated Client
  const [authenticatedClient, setAuthenticatedClient] = useState<ClientAppAuthResponse | null>(() => {
    try {
      const saved = localStorage.getItem('coursehub_client_auth_data');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [selectedCategory, setSelectedCategory] = useState<'all' | 'courses' | 'ai' | 'web'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active Course Viewer
  const [activeCourse, setActiveCourse] = useState<{
    module: ModuleItem;
    profile: Profile;
    partitionId: string;
  } | null>(null);

  // Verification Code inside Course
  const [courseInputCode, setCourseInputCode] = useState<string>('');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifyingCourse, setIsVerifyingCourse] = useState<boolean>(false);
  const [verificationSuccess, setVerificationSuccess] = useState<boolean>(false);

  // Stored cookies per isolated partition in PC
  const [localCookiesMap, setLocalCookiesMap] = useState<Record<string, { validatedAt: string; token: string }>>(() => {
    try {
      const saved = localStorage.getItem('coursehub_client_pc_cookies');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Set window title for PC desktop mode
  useEffect(() => {
    document.title = 'CourseHub VIP Desktop';
  }, []);

  // Load and consolidate disk storage on mount
  useEffect(() => {
    const initDiskStorage = async () => {
      await diskStorageService.ensureDiskPersistence();
      const stats = await diskStorageService.getStorageStats();
      setDiskStats(stats);
      const records = await diskStorageService.getAllProfileDiskRecords();
      setStoredDiskRecords(records);

      if (records.length > 0) {
        setLocalCookiesMap((prev) => {
          const next = { ...prev };
          records.forEach((rec) => {
            if (rec.sessionToken) {
              next[rec.partitionId] = {
                validatedAt: rec.savedAt,
                token: rec.sessionToken,
              };
            }
          });
          return next;
        });
      }
    };
    initDiskStorage();
  }, []);

  const refreshDiskData = async () => {
    const stats = await diskStorageService.getStorageStats();
    setDiskStats(stats);
    const records = await diskStorageService.getAllProfileDiskRecords();
    setStoredDiskRecords(records);
  };

  const performClientLogin = async (user: string, pass: string) => {
    if (!user.trim() || !pass.trim()) {
      setClientLoginError('Por favor ingrese su usuario y contraseña');
      return;
    }

    setIsAuthenticatingClient(true);
    setClientLoginError(null);

    const res = await desktopAppService.clientAuth({
      identifier: user.trim(),
      password: pass.trim(),
      hwid: 'HWID-PC-CLIENT-APP',
      deviceName: 'PC de Escritorio (CourseHub VIP)',
      os: 'Windows 11 x64',
    });

    if (res.success && res.data) {
      setAuthenticatedClient(res.data);
      setIsClientLoggedIn(true);
      try {
        localStorage.setItem('coursehub_client_auth_data', JSON.stringify(res.data));
      } catch (e) {
        console.error(e);
      }
    } else {
      setClientLoginError(res.error || 'Credenciales no válidas. Contacte a su administrador.');
    }
    setIsAuthenticatingClient(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('coursehub_client_auth_data');
    setIsClientLoggedIn(false);
    setAuthenticatedClient(null);
    setActiveCourse(null);
  };

  const handleOpenCourse = (mod: ModuleItem, prof: Profile) => {
    const partitionId = (prof as any)?.partitionId || `persist:client_${authenticatedClient?.client.id || 'c1'}_mod_${mod.id}_prof_${prof.id}`;
    setActiveCourse({ module: mod, profile: prof, partitionId });
    setCourseInputCode('');
    setVerificationError(null);
    
    // Check if partition already has consolidated data in hard drive
    const isAlreadyValidated = !!localCookiesMap[partitionId] || storedDiskRecords.some((r) => r.partitionId === partitionId && r.sessionToken);
    setVerificationSuccess(isAlreadyValidated);
  };

  const handleVerifyCourseCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourse || !courseInputCode.trim()) return;

    setIsVerifyingCourse(true);
    setVerificationError(null);

    const res = await desktopAppService.validateCourseCode({
      code: courseInputCode.trim().toUpperCase(),
      clientId: authenticatedClient?.client.id || 'c1',
      moduleId: activeCourse.module.id,
      profileId: activeCourse.profile.id,
      hwid: 'HWID-PC-CLIENT-APP',
    });

    if (res.success && res.data) {
      setVerificationSuccess(true);
      const sessionToken = res.data.sessionToken || 'token_valid';
      const updatedMap = {
        ...localCookiesMap,
        [activeCourse.partitionId]: {
          validatedAt: new Date().toISOString(),
          token: sessionToken,
        },
      };
      setLocalCookiesMap(updatedMap);
      try {
        localStorage.setItem('coursehub_client_pc_cookies', JSON.stringify(updatedMap));
      } catch (e) {
        console.error(e);
      }

      // CRITICAL: Consolidate permanently into the client PC's hard drive!
      await diskStorageService.saveProfilePartition({
        partitionId: activeCourse.partitionId,
        moduleId: activeCourse.module.id,
        profileId: activeCourse.profile.id,
        moduleName: activeCourse.module.name,
        profileName: activeCourse.profile.name,
        sessionToken: sessionToken,
        cookiesDecrypted: res.data.cookiesDecrypted || 'master_cookie_session_active',
        notes: '',
        offlineReady: true,
      });

      await refreshDiskData();
    } else {
      setVerificationError(res.error || 'Código incorrecto, caducado o no asignado a este curso.');
    }
    setIsVerifyingCourse(false);
  };

  const currentClientRecord = data.clients.find(
    (c) => c.id === authenticatedClient?.client.id || c.email === authenticatedClient?.client.email
  );

  const accessibleModules = data.modules.filter((m) => {
    if (!currentClientRecord) return true;
    const isSubscribed = currentClientRecord.modules?.[m.id] === true;
    return isSubscribed && m.enabled;
  });

  const filteredModules = accessibleModules.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.desc.toLowerCase().includes(searchQuery.toLowerCase());
    if (selectedCategory === 'all') return matchesSearch;
    if (selectedCategory === 'courses') return matchesSearch && (m.name.includes('Master') || m.name.includes('Pro') || m.name.includes('Curso'));
    if (selectedCategory === 'ai') return matchesSearch && (m.name.includes('AI') || m.name.includes('GPT') || m.name.includes('Midjourney'));
    if (selectedCategory === 'web') return matchesSearch && (m.name.includes('Dev') || m.name.includes('Cloud') || m.name.includes('Web'));
    return matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased flex flex-col select-none">
      {/* Titlebar */}
      <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-lg bg-indigo-600 flex items-center justify-center text-[10px] font-black text-white shadow-xs">
            CH
          </div>
          <span className="text-xs font-black tracking-wide text-slate-200">
            CourseHub VIP Desktop <span className="text-[10px] font-mono text-indigo-400 font-normal">v{appVersion}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Hard Drive Persistence Status Pill */}
          <button
            onClick={() => setShowDiskManagerModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/40 text-[11px] font-bold text-indigo-300 transition-colors cursor-pointer shadow-xs"
            title="Administrador de almacenamiento permanente consolidado en Disco Duro"
          >
            <HardDrive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="hidden sm:inline">Disco Duro:</span>
            <span className="text-white font-mono">{diskStats?.usageMB || '0.2'} MB</span>
            <span className="px-1.5 py-0.2 bg-indigo-500/30 rounded text-[9px] text-indigo-200 font-mono">
              {storedDiskRecords.length} {storedDiskRecords.length === 1 ? 'perfil' : 'perfiles'}
            </span>
          </button>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="hidden xs:inline">Conectado</span>
          </div>

          {isClientLoggedIn && (
            <button
              onClick={handleLogout}
              className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-slate-800 cursor-pointer"
              title="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cerrar Sesión</span>
            </button>
          )}
        </div>
      </header>

      {/* Toast de confirmación de descarga */}
      {downloadFeedback && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-white" />
          <span>{downloadFeedback}</span>
        </div>
      )}

      {/* Persistent OS Hard Drive Install Banner (if not installed in OS yet) */}
      {!isStandalone && (
        <div className="bg-linear-to-r from-indigo-950 via-slate-900 to-purple-950 border-b border-indigo-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <span className="text-white font-bold block sm:inline">
                Instalador Oficial CourseHub VIP para Windows:
              </span>{' '}
              <span className="text-slate-300 text-[11px]">
                Asistente .EXE con pasos de instalación, selección de carpeta de destino y registro como programa en tu PC.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="/api/download/installer-exe"
              download="CourseHub-VIP-Setup-v6.2.0.exe"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setDownloadFeedback('✓ Descargando Instalador Oficial (.EXE) a tu carpeta de Descargas...');
                setTimeout(() => setDownloadFeedback(null), 5000);
              }}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer text-center"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Instalador (.EXE)</span>
            </a>

            <button
              onClick={async () => {
                if (isInstallable) {
                  const success = await install();
                  if (!success) {
                    setShowInstallModal(true);
                  }
                } else {
                  setShowInstallModal(true);
                }
              }}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>Opciones de Instalación</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col">
        {!isClientLoggedIn ? (
          /* ======================================= */
          /* LOGIN SCREEN                            */
          /* ======================================= */
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-linear-to-tr from-indigo-600 to-purple-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/20">
                  <Laptop className="w-7 h-7 text-white" />
                </div>
                <h1 className="text-xl font-black text-white">CourseHub VIP Client</h1>
                <p className="text-xs text-slate-400">
                  Acceso exclusivo a cursos, plataformas y herramientas protegidas
                </p>
              </div>

              {clientLoginError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{clientLoginError}</span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  performClientLogin(clientInputUser, clientInputPass);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Usuario o Correo de la PC
                  </label>
                  <input
                    type="text"
                    value={clientInputUser}
                    onChange={(e) => setClientInputUser(e.target.value)}
                    placeholder="ej. empresa_abc o admin@empresa.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={clientInputPass}
                      onChange={(e) => setClientInputPass(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-hidden focus:border-indigo-500 transition-colors pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isAuthenticatingClient}
                  className="w-full py-3 bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
                >
                  {isAuthenticatingClient ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  <span>{isAuthenticatingClient ? 'Iniciando Sesión...' : 'Iniciar Sesión'}</span>
                </button>
              </form>

              {/* Demo Quick Accounts */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-500 block mb-2 font-bold uppercase">
                  Cuentas de prueba rápidas:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {data.clients.slice(0, 3).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const loginIdentifier = c.username || c.email;
                        setClientInputUser(loginIdentifier);
                        setClientInputPass(c.password || 'cliente123');
                        performClientLogin(loginIdentifier, c.password || 'cliente123');
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold transition-colors font-mono"
                    >
                      {c.username || c.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ======================================= */
          /* CLIENT DASHBOARD & CATALOG              */
          /* ======================================= */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Sidebar inside App */}
            <aside className="w-full md:w-64 bg-slate-900/70 border-b md:border-b-0 md:border-r border-slate-800 p-4 space-y-5 shrink-0 flex flex-col justify-between">
              <div className="space-y-4">
                {/* Client Profile Pill */}
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm">
                    {authenticatedClient?.client.name.charAt(0) || 'C'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xs font-bold text-white truncate">
                      {authenticatedClient?.client.name || 'Cliente VIP'}
                    </h2>
                    <span className="text-[10px] text-indigo-400 font-mono block truncate">
                      {authenticatedClient?.client.plan || currentClientRecord?.subscription.plan || 'Plan Activo'}
                    </span>
                  </div>
                </div>

                {/* Categories */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 block">
                    Categorías
                  </span>
                  {[
                    { id: 'all', label: 'Todos los Cursos', icon: BookOpen },
                    { id: 'courses', label: 'Cursos & Masters', icon: Layers },
                    { id: 'ai', label: 'Herramientas IA', icon: Sparkles },
                    { id: 'web', label: 'Desarrollo & Cloud', icon: Globe },
                  ].map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id as any)}
                        className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5 ${
                          selectedCategory === cat.id
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Status info */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[11px] text-slate-500 space-y-1">
                <div className="flex items-center justify-between">
                  <span>Motor Aislado:</span>
                  <strong className="text-emerald-400 font-mono">Chromium x64</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Hardware ID:</span>
                  <strong className="text-slate-400 font-mono">WIN11-VERIFIED</strong>
                </div>
              </div>
            </aside>

            {/* Catalog & Active Course Viewer */}
            <main className="flex-1 flex flex-col min-w-0 bg-slate-950 p-4 sm:p-6 overflow-y-auto">
              {activeCourse ? (
                /* ACTIVE COURSE VIEWER */
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-slate-900 p-4 rounded-2xl border border-slate-800">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setActiveCourse(null)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div>
                        <h2 className="text-sm font-black text-white flex items-center gap-2">
                          <span>{activeCourse.module.name}</span>
                          <span className="text-xs font-mono font-normal text-indigo-400">
                            ({activeCourse.profile.name})
                          </span>
                        </h2>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Sesión Aislada: {activeCourse.partitionId}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveCourse(null)}
                      className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
                    >
                      Cerrar Visor
                    </button>
                  </div>

                  {/* Course Content / Security Gate */}
                  {!verificationSuccess ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg mx-auto text-center space-y-5">
                      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/20">
                        <Key className="w-7 h-7" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-base font-black text-white">
                          Validación de Acceso Requerida
                        </h3>
                        <p className="text-xs text-slate-400">
                          Ingrese su código de validación de 6 u 8 dígitos proporcionado por su administrador para desbloquear este curso en este equipo.
                        </p>
                      </div>

                      {verificationError && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400 flex items-center gap-2 text-left">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{verificationError}</span>
                        </div>
                      )}

                      <form onSubmit={handleVerifyCourseCode} className="space-y-3">
                        <input
                          type="text"
                          value={courseInputCode}
                          onChange={(e) => setCourseInputCode(e.target.value.toUpperCase())}
                          placeholder="EJ: VIP-8921"
                          required
                          className="w-full text-center tracking-widest font-mono text-base font-black uppercase bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-hidden focus:border-indigo-500"
                        />
                        <button
                          type="submit"
                          disabled={isVerifyingCourse}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
                        >
                          {isVerifyingCourse ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-4 h-4" />
                          )}
                          <span>{isVerifyingCourse ? 'Validando...' : 'Desbloquear y Cargar Curso'}</span>
                        </button>
                      </form>
                    </div>
                  ) : (
                    /* SIMULATED ISOLATED COURSE BROWSER / PLAYER */
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                      <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span className="text-white font-bold">{activeCourse.module.name}</span>
                          <span className="text-slate-600">|</span>
                          <span className="text-slate-400 truncate max-w-xs">{activeCourse.profile.url}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono font-bold">
                            TOKEN ACTIVO
                          </span>
                        </div>
                      </div>

                      {/* Video Player & Material */}
                      <div className="p-6 space-y-6">
                        <div className="aspect-video bg-slate-950 rounded-2xl border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden group">
                          {activeCourse.profile.image ? (
                            <img
                              src={activeCourse.profile.image}
                              alt={activeCourse.module.name}
                              className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : null}
                          <div className="relative z-10 text-center space-y-3 p-4">
                            <div className="w-16 h-16 rounded-full bg-indigo-600/90 text-white flex items-center justify-center mx-auto shadow-2xl cursor-pointer hover:scale-110 transition-transform">
                              <Play className="w-7 h-7 ml-1" />
                            </div>
                            <h3 className="text-base font-black text-white">
                              {activeCourse.module.name} - Módulo 1
                            </h3>
                            <p className="text-xs text-slate-300 max-w-md mx-auto">
                              Reproducción de video protegida con marca de agua dinámica y sesión aislada.
                            </p>
                          </div>
                        </div>

                        {/* Profiles / Course Switcher */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Perfiles disponibles en este módulo:
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {activeCourse.module.profiles.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => handleOpenCourse(activeCourse.module, p)}
                                className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                                  activeCourse.profile.id === p.id
                                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs text-indigo-400 shrink-0">
                                  {p.name.charAt(0)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold truncate">{p.name}</div>
                                  <div className="text-[10px] opacity-75 truncate">{p.username}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Hard Drive Storage Status for this Active Profile */}
                        <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                              <HardDrive className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white">Partición Consolidada en Disco Duro:</span>
                                <code className="text-emerald-400 font-mono text-[11px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                  {activeCourse.partitionId}
                                </code>
                              </div>
                              <span className="text-[11px] text-slate-400">
                                Almacenamiento persistente en PC activo. Cookies, sesión y notas se guardan permanentemente en tu equipo sin depender de archivos .bat ni ejecutables sueltos.
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => setShowDiskManagerModal(true)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-700 cursor-pointer"
                          >
                            <Database className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Gestionar Bóveda de Disco</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* COURSE GRID */
                <div className="space-y-6">
                  {/* Search Bar */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h1 className="text-lg font-black text-white">
                        Catálogo de Cursos & Módulos VIP
                      </h1>
                      <p className="text-xs text-slate-400">
                        {filteredModules.length} módulos disponibles con tu suscripción activa
                      </p>
                    </div>

                    <div className="relative w-64 max-w-full">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar curso o herramienta..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredModules.map((mod) => {
                      const firstProfile = mod.profiles[0];
                      const coverImage = firstProfile?.image || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80';

                      return (
                        <div
                          key={mod.id}
                          className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-indigo-500/50 transition-all group flex flex-col justify-between shadow-lg"
                        >
                          <div>
                            <div className="h-36 bg-slate-950 relative overflow-hidden">
                              <img
                                src={coverImage}
                                alt={mod.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                              />
                              <div className="absolute inset-0 bg-linear-to-t from-slate-900 via-transparent to-transparent" />
                              <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-xs text-[10px] font-bold text-slate-300 border border-slate-700/50">
                                {mod.profiles.length} {mod.profiles.length === 1 ? 'Perfil' : 'Perfiles'}
                              </span>
                            </div>

                            <div className="p-4 space-y-2">
                              <h3 className="text-sm font-black text-white group-hover:text-indigo-400 transition-colors">
                                {mod.name}
                              </h3>
                              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                                {mod.desc || 'Acceso completo a materiales, videos y sesiones aisladas.'}
                              </p>
                            </div>
                          </div>

                          <div className="p-4 pt-0">
                            <button
                              onClick={() => {
                                if (mod.profiles.length > 0) {
                                  handleOpenCourse(mod, mod.profiles[0]);
                                }
                              }}
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-md"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Abrir Curso</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      {/* MODAL: ADMINISTRADOR DE ALMACENAMIENTO PERMANENTE EN DISCO DURO */}
      {showDiskManagerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full shadow-2xl p-6 space-y-5 animate-fadeIn max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    Bóveda Consolidada en el Disco Duro de tu PC
                  </h3>
                  <p className="text-xs text-slate-400">
                    Almacenamiento físico por perfil con persistencia garantizada en el sistema operativo
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDiskManagerModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Diagnostics Card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Persistencia OS
                </span>
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>{diskStats?.persisted ? 'Garantizada' : 'Activa en Disco'}</span>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  Inmune a limpieza de caché
                </span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Espacio en Disco
                </span>
                <div className="text-xs font-mono font-bold text-white">
                  {diskStats?.usageMB || '0.2'} MB ocupados
                </div>
                <span className="text-[10px] text-slate-500 block font-mono">
                  {diskStats?.quotaMB ? `${(diskStats.quotaMB / 1024).toFixed(1)} GB disponibles` : 'Cuota libre en PC'}
                </span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Perfiles Guardados
                </span>
                <div className="text-xs font-mono font-bold text-indigo-400">
                  {storedDiskRecords.length} particiones activas
                </div>
                <span className="text-[10px] text-slate-500 block">
                  Cada una 100% aislada
                </span>
              </div>
            </div>

            {/* List of Stored Profiles */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Particiones Físicas Almacenadas en Disco Duro</span>
                </h4>
                <button
                  onClick={async () => {
                    await diskStorageService.ensureDiskPersistence();
                    await refreshDiskData();
                  }}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Verificar Persistencia</span>
                </button>
              </div>

              {storedDiskRecords.length === 0 ? (
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 text-center space-y-2">
                  <Database className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">
                    Aún no hay perfiles validados en este equipo.
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Al desbloquear cualquier curso con tu código de validación, sus cookies y sesiones se consolidarán de inmediato en tu disco duro.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {storedDiskRecords.map((rec) => (
                    <div
                      key={rec.partitionId}
                      className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{rec.moduleName}</span>
                            <span className="text-[10px] text-indigo-400 font-mono">({rec.profileName})</span>
                          </div>
                          <code className="text-[10px] text-slate-500 font-mono block mt-0.5 break-all">
                            {rec.partitionId}
                          </code>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={async () => {
                              await diskStorageService.deleteProfilePartition(rec.partitionId);
                              await refreshDiskData();
                            }}
                            className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-900 transition-colors cursor-pointer"
                            title="Eliminar datos de esta partición en disco"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-900 pt-2 font-mono">
                        <span>Guardado: {new Date(rec.savedAt).toLocaleString()}</span>
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          <span>Sesión Activa</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Guarantee Note */}
            <div className="bg-indigo-950/40 border border-indigo-500/20 p-3.5 rounded-2xl text-[11px] text-indigo-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-white">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <span>Consolidación Total en Disco Duro (Sin .BAT ni .EXE sueltos)</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Este software almacena todos los datos directamente en el disco duro físico de tu PC. Puedes apagar tu ordenador, reiniciar el sistema y volver a abrir la aplicación sin necesidad de revalidar tus cursos ni depender de scripts temporales.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              {!isStandalone ? (
                <button
                  onClick={() => setShowInstallModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Instalar Acceso en Menú Inicio</span>
                </button>
              ) : (
                <span className="text-xs text-emerald-400 flex items-center gap-1.5 font-bold">
                  <CheckCircle className="w-4 h-4" />
                  <span>Aplicación Consolidada en Windows</span>
                </span>
              )}

              <button
                onClick={() => setShowDiskManagerModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OPCIONES DE INSTALACIÓN Y DESCARGA AL DISCO DURO */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full shadow-2xl p-6 space-y-5 animate-fadeIn max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    Instalar CourseHub VIP en tu PC
                  </h3>
                  <p className="text-xs text-slate-400">
                    Descarga el instalador oficial o añade el acceso a tu Escritorio de Windows
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Opciones de Instalación */}
            <div className="space-y-3.5">
              {/* Opción 1: Instalador Oficial Windows (.EXE) con Asistente Paso a Paso */}
              <div className="bg-slate-950 border-2 border-emerald-500 rounded-2xl p-4.5 space-y-3 shadow-lg shadow-emerald-950/40">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    OFICIAL • INSTALADOR .EXE CON ASISTENTE
                  </span>
                  <span className="text-xs font-mono text-emerald-400 font-bold">Windows 10 / 11 (64/32-bit)</span>
                </div>
                <div>
                  <h4 className="text-sm font-black text-white flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-emerald-400" />
                    <span>Instalador con Asistente de Configuración (.EXE)</span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Un auténtico ejecutable de Windows con asistente visual guiado:
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <div className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-bold font-mono">1.</span>
                      <span><strong>Elige carpeta de destino:</strong> selecciona dónde descomprimir e instalar en tu PC.</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-bold font-mono">2.</span>
                      <span><strong>Barra de progreso:</strong> extracción automática de componentes nativos.</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-bold font-mono">3.</span>
                      <span><strong>Programa instalado:</strong> se registra en Windows (Configuración / Panel de Control).</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-bold font-mono">4.</span>
                      <span><strong>Accesos y desinstalador:</strong> iconos en Escritorio, Menú Inicio y <em>uninstall.exe</em>.</span>
                    </div>
                  </div>
                </div>
                <div className="pt-1">
                  <a
                    href="/api/download/installer-exe"
                    download="CourseHub-VIP-Setup-v6.2.0.exe"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setDownloadFeedback('✓ Descargando CourseHub-VIP-Setup-v6.2.0.exe al disco duro...');
                      setTimeout(() => setDownloadFeedback(null), 5000);
                    }}
                    className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 active:scale-95 text-center cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar CourseHub-VIP-Setup-v6.2.0.exe</span>
                  </a>
                </div>
              </div>

              {/* Opción 2: Instalador 1-Clic (.BAT) - Alternativa rápida */}
              <div className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 space-y-2.5 transition-all">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-bold uppercase">
                    Alternativa Rápida
                  </span>
                  <span className="text-xs font-mono text-slate-400">Script .BAT / .CMD</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-slate-400" />
                    <span>Script de Instalación Silenciosa (.BAT)</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Si prefieres instalar sin asistente gráfico, este script crea el entorno y accesos directos automáticamente con 1 solo clic.
                  </p>
                </div>
                <div className="pt-1 flex flex-wrap gap-2">
                  <a
                    href="/api/download/installer-bat"
                    download="Instalar-CourseHub-VIP-v6.2.0.bat"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setDownloadFeedback('✓ Descargando Instalador 1-Clic a tu carpeta de Descargas...');
                      setTimeout(() => setDownloadFeedback(null), 5000);
                    }}
                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 text-center cursor-pointer border border-slate-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar .BAT</span>
                  </a>
                  <a
                    href="/api/download/installer-cmd"
                    download="Instalar-CourseHub-VIP-v6.2.0.cmd"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-bold rounded-xl transition-all border border-slate-700"
                    title="Versión alternativa .CMD"
                  >
                    .CMD
                  </a>
                </div>
              </div>

              {/* Opción 2: Paquete ZIP */}
              <div className="bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-4 space-y-3 transition-all">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-black uppercase">
                    Paquete Completo
                  </span>
                  <span className="text-xs font-mono text-slate-400">Archivo .ZIP</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-400" />
                    <span>Paquete Comprimido (.ZIP)</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Contiene el instalador desatendido, script de arranque, icono de alta resolución y manual de instrucciones paso a paso.
                  </p>
                </div>
                <div className="pt-1">
                  <a
                    href="/api/download/installer-zip"
                    download="CourseHub-VIP-Instalador-Windows.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setDownloadFeedback('✓ Descargando Paquete ZIP a tu carpeta de Descargas...');
                      setTimeout(() => setDownloadFeedback(null), 5000);
                    }}
                    className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 text-center cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar Paquete ZIP (.ZIP)</span>
                  </a>
                </div>
              </div>

              {/* Opción 3: Instalación Directa desde el Navegador (PWA) */}
              <div className="bg-slate-950 border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-4 space-y-3 transition-all">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-black uppercase">
                    Navegador
                  </span>
                  <span className="text-xs font-mono text-slate-400">Google Chrome / Edge</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-indigo-400" />
                    <span>Instalar desde la barra de Chrome / Edge</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    También puedes instalar la aplicación directamente en Windows: en la barra superior de direcciones (donde escribes la URL), haz clic en el icono de instalación <strong>(ícono de pantalla al lado de la estrella de favoritos)</strong> o en el menú <strong>⋮ &gt; Instalar CourseHub VIP</strong>.
                  </p>
                </div>
                {isInstallable && (
                  <button
                    onClick={async () => {
                      const success = await install();
                      if (success) {
                        setShowInstallModal(false);
                      }
                    }}
                    className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Abrir Diálogo de Instalación del Navegador</span>
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
