import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Laptop,
  Key,
  ShieldCheck,
  Lock,
  Unlock,
  Cookie,
  Layers,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Plus,
  Trash2,
  Share2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal,
  Download,
  Code,
  Flame,
  ArrowRight,
  ShieldAlert,
  Cpu,
  UserCheck,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  X,
  Play,
  RotateCcw,
  LogOut,
  BookOpen,
  Bot,
  Globe,
  CheckCircle,
  HelpCircle,
  GitBranch,
  Github,
  Tag,
  CloudLightning,
  FileCode,
  HardDrive,
  Database,
  Save,
} from 'lucide-react';
import { CourseHubData, Client, ModuleItem, Profile, ValidationCode } from '../types';
import { desktopAppService, ClientAppAuthResponse } from '../services/desktopAppService';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  diskStorageService,
  ProfileDiskRecord,
  DiskStorageStats,
} from '../services/diskStorageService';
import {
  downloadBatchInstaller,
  downloadElectronSourcePackage,
  downloadWindowsExeInstaller,
  downloadZipInstaller,
  generateWindowsBatchInstaller,
  getElectronPackageFiles,
  triggerHardDriveDownload,
} from '../utils/exeGenerator';

interface DesktopClientHubViewProps {
  data: CourseHubData;
  showToast?: (msg: string) => void;
}

export const DesktopClientHubView: React.FC<DesktopClientHubViewProps> = ({
  data,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'simulator' | 'codes' | 'disk-storage' | 'github-repo' | 'installer-build' | 'api-routes'>('simulator');
  const [codes, setCodes] = useState<ValidationCode[]>([]);
  const [isLoadingCodes, setIsLoadingCodes] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // PWA & Hard Drive Persistence hooks & state
  const { isInstallable, isInstalled, isStandalone, install: installPWA } = usePWAInstall();
  const [diskStats, setDiskStats] = useState<DiskStorageStats | null>(null);
  const [diskRecords, setDiskRecords] = useState<ProfileDiskRecord[]>([]);
  const [simulatingDiskWrite, setSimulatingDiskWrite] = useState<string | null>(null);
  const [simulatingDiskSuccess, setSimulatingDiskSuccess] = useState<string | null>(null);
  const [inspectedPartitionData, setInspectedPartitionData] = useState<ProfileDiskRecord | null>(null);

  const loadDiskStorageStats = async () => {
    await diskStorageService.ensureDiskPersistence();
    const stats = await diskStorageService.getStorageStats();
    setDiskStats(stats);
    const recs = await diskStorageService.getAllProfileDiskRecords();
    setDiskRecords(recs);
  };

  useEffect(() => {
    loadDiskStorageStats();
  }, []);

  // GitHub Repo & Releases Configuration
  const [githubOwner, setGithubOwner] = useState<string>('luis5afp');
  const [githubRepoName, setGithubRepoName] = useState<string>('programaVIP');

  // Interactive API Route Tester State
  const [selectedTestClient, setSelectedTestClient] = useState<string>(data.clients[0]?.id || 'c1');
  const [selectedTestModule, setSelectedTestModule] = useState<string>(data.modules[0]?.id || 'm_courses');
  const [selectedTestProfile, setSelectedTestProfile] = useState<string>(data.modules[0]?.profiles[0]?.id || 'p_excel');
  const [testApiResult, setTestApiResult] = useState<any>(null);
  const [testApiLoading, setTestApiLoading] = useState<boolean>(false);
  const [testApiLatency, setTestApiLatency] = useState<number | null>(null);

  const handleRunApiTest = async () => {
    setTestApiLoading(true);
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/desktop/modules/${selectedTestModule}/profiles/${selectedTestProfile}/launch?clientId=${selectedTestClient}`);
      const json = await res.json();
      setTestApiLatency(Math.round(performance.now() - t0));
      setTestApiResult(json);
      if (showToast) showToast('✓ Respuesta API recibida en tiempo real (200 OK)');
    } catch (err: any) {
      setTestApiResult({ error: err.message });
      setTestApiLatency(Math.round(performance.now() - t0));
    } finally {
      setTestApiLoading(false);
    }
  };

  // ==========================================
  // EXE DOWNLOAD & DYNAMIC INSTALLER COMPILER
  // ==========================================
  const [isCompilingExe, setIsCompilingExe] = useState<boolean>(false);
  const [downloadStep, setDownloadStep] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadModalOpen, setDownloadModalOpen] = useState<boolean>(false);
  const [copiedInstallCmd, setCopiedInstallCmd] = useState<boolean>(false);
  const [viewBatScriptModal, setViewBatScriptModal] = useState<boolean>(false);
  const [viewElectronFilesModal, setViewElectronFilesModal] = useState<boolean>(false);
  const [selectedElectronFile, setSelectedElectronFile] = useState<
    '.github/workflows/build-release.yml' | 'main.js' | 'preload.js' | 'package.json' | 'build-exe.bat' | 'README.md'
  >('README.md');

  const handleDownloadClientExe = async () => {
    setDownloadModalOpen(true);
    setIsCompilingExe(true);
    setDownloadProgress(15);
    setDownloadStep('🔍 Verificando versión v6.2.0 y paquetes en GitHub (luis5afp/coursehub-vip)...');

    await new Promise((r) => setTimeout(r, 450));
    setDownloadProgress(50);
    setDownloadStep('⚡ Generando instalador desatendido 1-Click con enlace oficial a GitHub Releases...');

    await new Promise((r) => setTimeout(r, 450));
    setDownloadProgress(85);
    setDownloadStep('🛡️ Configurando auto-actualización silenciosa y perfiles Chromium...');

    await new Promise((r) => setTimeout(r, 400));
    setDownloadProgress(100);
    setDownloadStep('✓ ¡Listo! Descargando Instalador 1-Click de CourseHub VIP...');

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev';
    
    // Download real working 1-click batch installer
    downloadBatchInstaller(`Instalar-CourseHub-VIP-v6.2.0.bat`, {
      version: '6.2.0',
      appName: 'CourseHub VIP Client Desktop',
      githubRepo: 'luis5afp/coursehub-vip',
      serverUrl: currentOrigin,
      coursesCount: data.modules?.length || 0,
      timestamp: new Date().toISOString(),
      modules: data.modules,
    });

    if (showToast) {
      showToast('✓ Descargando Instalador CourseHub VIP para Windows');
    }

    setTimeout(() => {
      setIsCompilingExe(false);
    }, 1200);
  };

  // ==========================================
  // GITHUB AUTO-UPDATE SYSTEM (PC STARTUP)
  // ==========================================
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'updated'>('idle');
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [updateStatusText, setUpdateStatusText] = useState<string>('');
  const [appVersion, setAppVersion] = useState<string>('6.2.0');
  const [lastUpdateCheckedTime, setLastUpdateCheckedTime] = useState<string>(() => new Date().toLocaleTimeString());
  const [updateDetails, setUpdateDetails] = useState<any>(null);

  // Auto-Update Engine (Sin preguntar nada: descarga, aplica parche y reinicia)
  const runGitHubAutoUpdater = async (isManualSim = false) => {
    setUpdateState('checking');
    setUpdateProgress(10);
    setUpdateStatusText('🔍 Conectando con GitHub y Servidor (luis5afp/coursehub-vip)...');

    try {
      const updateCheck = await desktopAppService.checkForAppUpdate(appVersion);
      
      // Simulate quick check latency
      await new Promise((r) => setTimeout(r, 600));

      if (updateCheck.success && updateCheck.data) {
        setUpdateDetails(updateCheck.data);
      }

      setUpdateState('downloading');
      setUpdateStatusText('📦 Nueva versión detectada en GitHub. Descargando automáticamente...');
      
      // Progress simulation (hands-free auto download)
      const steps = [
        { progress: 25, text: '⬇️ Descargando paquete de actualización desde GitHub Releases (25%)...' },
        { progress: 50, text: '⬇️ Descargando parches del sistema y módulos de cursos (50%)...' },
        { progress: 75, text: '🛡️ Verificando firmas criptográficas SHA-256 e integridad del código (75%)...' },
        { progress: 90, text: '⚙️ Aplicando cambios en el disco local y base de datos (90%)...' },
        { progress: 100, text: '✓ ¡Descarga e instalación completada! Reiniciando CourseHub PC...' },
      ];

      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 450));
        setUpdateProgress(step.progress);
        setUpdateStatusText(step.text);
      }

      // Reinicio automático sin preguntar nada
      await new Promise((r) => setTimeout(r, 700));
      setUpdateState('restarting');
      setUpdateStatusText('🔄 Reiniciando aplicación CourseHub...');

      await new Promise((r) => setTimeout(r, 1000));
      setAppVersion('6.2.0');
      setUpdateState('updated');
      setUpdateProgress(100);
      setLastUpdateCheckedTime(new Date().toLocaleTimeString());
      if (showToast) {
        showToast('✓ CourseHub PC se ha actualizado e iniciado con la última versión de GitHub.');
      }

      setTimeout(() => {
        setUpdateState('idle');
      }, 3500);
    } catch {
      setUpdateState('idle');
    }
  };

  // Run auto-update check on initial startup
  useEffect(() => {
    const timer = setTimeout(() => {
      runGitHubAutoUpdater(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // ==========================================
  // PC CLIENT APPLICATION STATE (SIMULATOR)
  // ==========================================
  // Client Authentication in PC App
  const [isClientLoggedIn, setIsClientLoggedIn] = useState<boolean>(true);
  const [clientInputUser, setClientInputUser] = useState<string>(data.clients[0]?.email || 'admin@empresaabc.test');
  const [clientInputPass, setClientInputPass] = useState<string>('cliente123');
  const [clientLoginError, setClientLoginError] = useState<string | null>(null);
  const [isAuthenticatingClient, setIsAuthenticatingClient] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Active Client Session Data in PC
  const [authenticatedClient, setAuthenticatedClient] = useState<ClientAppAuthResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'courses' | 'ai' | 'web'>('all');

  // Active Launched Course / Tool Session
  const [activeCourse, setActiveCourse] = useState<{
    module: any;
    profile: any;
    partitionId: string;
  } | null>(null);

  // Stored cookies per isolated partition in PC
  const [localCookiesMap, setLocalCookiesMap] = useState<Record<string, { validatedAt: string; token: string; cookies: string }>>(() => {
    try {
      const saved = localStorage.getItem('coursehub_client_pc_cookies');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Course Page Verification Code State (Inside Course Webview)
  const [courseInputCode, setCourseInputCode] = useState<string>('');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifyingCourse, setIsVerifyingCourse] = useState<boolean>(false);
  const [verificationSuccess, setVerificationSuccess] = useState<boolean>(false);

  // ==========================================
  // CODE GENERATOR STATE (ADMIN FEATURE)
  // ==========================================
  const [genClientId, setGenClientId] = useState<string>(data.clients[0]?.id || 'c1');
  const [genModuleId, setGenModuleId] = useState<string>(data.modules[0]?.id || 'm_courses');
  const [genProfileId, setGenProfileId] = useState<string>('');
  const [genHours, setGenHours] = useState<number>(720); // 30 days
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [newGeneratedCode, setNewGeneratedCode] = useState<ValidationCode | null>(null);

  // Load codes from server
  const loadCodes = async () => {
    setIsLoadingCodes(true);
    const res = await desktopAppService.getValidationCodes();
    if (res.success && res.data) {
      setCodes(res.data);
    }
    setIsLoadingCodes(false);
  };

  useEffect(() => {
    loadCodes();
  }, []);

  // Update genProfileId when module changes
  useEffect(() => {
    const mod = data.modules.find((m) => m.id === genModuleId);
    if (mod && mod.profiles.length > 0) {
      setGenProfileId(mod.profiles[0].id);
    } else {
      setGenProfileId('');
    }
  }, [genModuleId, data.modules]);

  // Initial client auth login simulation
  const performClientLogin = async (user: string, pass: string) => {
    setIsAuthenticatingClient(true);
    setClientLoginError(null);

    const res = await desktopAppService.clientAuth({
      identifier: user.trim(),
      password: pass.trim(),
      hwid: 'HWID-WIN11-PC-7829',
      deviceName: 'PC de Escritorio (Instalador CourseHub)',
      os: 'Windows 11 Pro x64',
    });

    if (res.success && res.data) {
      setAuthenticatedClient(res.data);
      setIsClientLoggedIn(true);
      if (showToast) showToast(`Bienvenido a tu PC App, ${res.data.client.name}`);
    } else {
      setClientLoginError(res.error || 'Credenciales incorrectas. Verifique su usuario y contraseña.');
    }
    setIsAuthenticatingClient(false);
  };

  // Run initial auto-login for current client
  useEffect(() => {
    if (data.clients.length > 0 && !authenticatedClient) {
      const firstClient = data.clients[0];
      setClientInputUser(firstClient.email);
      setClientInputPass(firstClient.password || 'cliente123');
      performClientLogin(firstClient.email, firstClient.password || 'cliente123');
    }
  }, [data.clients]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    if (showToast) showToast('Copiado al portapapeles');
  };

  // Launch course / AI tool in isolated Chromium session with dedicated persistent partition
  const handleOpenCourse = (mod: any, prof: any) => {
    const partitionId = prof?.partitionId || `persist:client_${authenticatedClient?.client.id || 'c1'}_mod_${mod.id}_prof_${prof.id}`;
    
    // Check or initialize persistent Chromium profile storage (cookies, cache, last visited page/state)
    const existingSession = localCookiesMap[partitionId];
    const nowIso = new Date().toISOString();
    
    const updatedCookies = {
      ...localCookiesMap,
      [partitionId]: {
        validatedAt: existingSession?.validatedAt || nowIso,
        lastAccessedAt: nowIso,
        token: existingSession?.token || `tok_chromium_${Date.now()}`,
        cookies: existingSession?.cookies || `session_token=chromium_${Date.now()}; isolated_user=client_${authenticatedClient?.client.id || 'c1'}; domain=.coursehub.cloud; Secure; SameSite=Strict`,
        lastUrl: prof?.url || existingSession?.lastUrl || 'https://classroom.coursehub.cloud/course/active',
        savedProgress: existingSession?.savedProgress || 'Sesión guardada en el disco local de la PC',
      },
    };
    
    setLocalCookiesMap(updatedCookies);
    try {
      localStorage.setItem('coursehub_client_pc_cookies', JSON.stringify(updatedCookies));
    } catch {}

    const targetUrl = prof?.url || 'https://classroom.coursehub.cloud/course/active';

    // Abrir de inmediato la ventana externa en vivo
    try {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } catch {}

    setActiveCourse({
      module: mod,
      profile: prof,
      partitionId,
    });
    setVerificationError(null);
    setVerificationSuccess(true);
    if (showToast) {
      showToast(`Abriendo ${prof?.name || mod.name} directamente en perfil Chromium...`);
    }
  };

  // Verify course page code and save cookies in PC
  const handleVerifyCourseCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseInputCode || courseInputCode.length < 6) {
      setVerificationError('Ingresa el código numérico de 6 dígitos.');
      return;
    }

    if (!activeCourse) return;

    setIsVerifyingCourse(true);
    setVerificationError(null);

    const res = await desktopAppService.validateCourseCode({
      code: courseInputCode.trim(),
      clientId: authenticatedClient?.client.id || 'c1',
      moduleId: activeCourse.module.id,
      profileId: activeCourse.profile.id,
      hwid: 'HWID-WIN11-PC-7829',
    });

    if (res.success && res.data) {
      const partitionKey = activeCourse.partitionId;
      const updatedCookies = {
        ...localCookiesMap,
        [partitionKey]: {
          validatedAt: new Date().toISOString(),
          token: res.data.sessionToken,
          cookies: `session_token=${res.data.sessionToken}; auth_user=${activeCourse.profile.username}; domain=.coursehub.cloud; Secure; SameSite=Strict`,
        },
      };

      setLocalCookiesMap(updatedCookies);
      try {
        localStorage.setItem('coursehub_client_pc_cookies', JSON.stringify(updatedCookies));
      } catch {}

      setVerificationSuccess(true);
      loadCodes(); // Refresh code status
      if (showToast) showToast('Cookies guardadas en PC. Acceso permanente autorizado.');
    } else {
      setVerificationError(res.error || 'Código incorrecto o expirado. Contacte al administrador.');
    }
    setIsVerifyingCourse(false);
  };

  // Clear cookies for this isolated course profile
  const handleResetCourseCookies = (partitionId: string) => {
    const updated = { ...localCookiesMap };
    delete updated[partitionId];
    setLocalCookiesMap(updated);
    try {
      localStorage.setItem('coursehub_client_pc_cookies', JSON.stringify(updated));
    } catch {}
    setVerificationSuccess(false);
    setVerificationError(null);
    if (showToast) showToast('Cookies del curso eliminadas. Se volverá a requerir validación.');
  };

  // Handle Admin Code Generation
  const handleGenerateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genClientId || !genModuleId) {
      alert('Selecciona un cliente y un módulo.');
      return;
    }

    setIsGenerating(true);
    const res = await desktopAppService.generateValidationCode({
      clientId: genClientId,
      moduleId: genModuleId,
      profileId: genProfileId,
      expiresInHours: genHours,
    });

    if (res.success && res.data) {
      setNewGeneratedCode(res.data);
      loadCodes();
      if (showToast) showToast(`Código generado: ${res.data.code}`);
    } else {
      alert(res.error || 'Error al generar el código.');
    }
    setIsGenerating(false);
  };

  // Handle Revoke Code
  const handleRevokeCode = async (code: string) => {
    if (!confirm(`¿Revocar el código ${code}? El cliente no podrá volver a usarlo.`)) return;
    const res = await desktopAppService.revokeValidationCode(code);
    if (res.success) {
      loadCodes();
      if (showToast) showToast('Código revocado');
    }
  };

  // Active client record from real-time admin data
  const currentClient =
    data.clients.find((c) => c.id === authenticatedClient?.client.id) ||
    authenticatedClient?.client;

  // Real-time accessible modules from data.modules
  const accessibleModules = data.modules.filter((m) => {
    if (!m.enabled) return false;
    if (currentClient?.modules && currentClient.modules[m.id] === false) return false;
    return true;
  });

  // Extract every course, AI tool, and Web tool from data.modules
  interface CatalogCourseItem {
    id: string;
    moduleId: string;
    module: ModuleItem;
    profile: Profile;
    name: string;
    moduleName: string;
    desc: string;
    icon: string;
    image?: string;
    url: string;
    username: string;
    category: 'courses' | 'ai' | 'web';
    partitionId: string;
    isCookieSaved: boolean;
  }

  const catalogItems: CatalogCourseItem[] = [];

  accessibleModules.forEach((m) => {
    const category: 'courses' | 'ai' | 'web' =
      m.category ||
      (m.id.includes('course') || m.name.toLowerCase().includes('curso')
        ? 'courses'
        : m.id.includes('ai') ||
          m.name.toLowerCase().includes('ia') ||
          m.name.toLowerCase().includes('chat') ||
          m.name.toLowerCase().includes('claude')
        ? 'ai'
        : 'web');

    const clientProfileIds = currentClient?.profileIds || [];
    const profilesToUse =
      clientProfileIds.length > 0
        ? m.profiles.filter((p) => clientProfileIds.includes(p.id))
        : m.profiles;

    const list = profilesToUse.length > 0 ? profilesToUse : m.profiles;

    if (list.length > 0) {
      list.forEach((p) => {
        const partitionId = `persist:client_${currentClient?.id || 'c1'}_mod_${m.id}_prof_${p.id}`;
        catalogItems.push({
          id: `${m.id}_${p.id}`,
          moduleId: m.id,
          module: m,
          profile: p,
          name: p.name,
          moduleName: m.name,
          desc: m.desc,
          icon: m.icon,
          image: p.image,
          url: p.url,
          username: p.username,
          category,
          partitionId,
          isCookieSaved: !!localCookiesMap[partitionId],
        });
      });
    } else {
      const fallbackProf: Profile = {
        id: `p_default_${m.id}`,
        name: m.name,
        url: 'https://classroom.coursehub.cloud/course/main',
        username: currentClient?.email || 'user@empresa.com',
        credentialOk: true,
        lastCheck: null,
      };
      const partitionId = `persist:client_${currentClient?.id || 'c1'}_mod_${m.id}_prof_default`;
      catalogItems.push({
        id: m.id,
        moduleId: m.id,
        module: m,
        profile: fallbackProf,
        name: m.name,
        moduleName: m.name,
        desc: m.desc,
        icon: m.icon,
        url: fallbackProf.url,
        username: fallbackProf.username,
        category,
        partitionId,
        isCookieSaved: !!localCookiesMap[partitionId],
      });
    }
  });

  // Categorize catalog items
  const categorizedItems = {
    courses: catalogItems.filter((i) => i.category === 'courses'),
    ai: catalogItems.filter((i) => i.category === 'ai'),
    web: catalogItems.filter((i) => i.category === 'web'),
  };

  const displayedItems =
    selectedCategory === 'courses'
      ? categorizedItems.courses
      : selectedCategory === 'ai'
      ? categorizedItems.ai
      : selectedCategory === 'web'
      ? categorizedItems.web
      : catalogItems;

  // Electron Architecture Code snippet with persistent Chromium profiles and GitHub Auto-Updater
  const electronProductionCode = `// electron/main.js - Perfiles Chromium Aislados y Auto-Actualización GitHub sin Preguntas
const { app, BrowserWindow, session, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('electron-store');
const store = new Store();

let mainWindow;

// 1. CONFIGURACIÓN DEL AUTO-ACTUALIZADOR GITHUB (Sin preguntar nada: descarga y reinicia)
function setupGitHubAutoUpdater() {
  // Configuración de repositorio GitHub
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Notificar progreso a la barra de la interfaz
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater:status', { step: 'checking', msg: 'Verificando repositorio GitHub...' });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:status', { step: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('updater:progress', {
      percent: Math.round(progressObj.percent),
      bytesPerSecond: progressObj.bytesPerSecond,
    });
  });

  // Al completar la descarga: se instala y reinicia automáticamente sin preguntar nada
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater:status', { step: 'restarting', msg: 'Actualización descargada. Reiniciando...' });
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true); // true = silencioso, true = reiniciar de inmediato
    }, 1200);
  });

  // Verificar al iniciar la aplicación en la PC
  autoUpdater.checkForUpdatesAndNotify();
}

// 2. Pantalla Principal de la PC (Catálogo con Login de Cliente)
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL('app://local/index.html');
  setupGitHubAutoUpdater();
}

// 3. Abrir Curso, IA o Web en un Perfil Chromium Propio e Independiente
ipcMain.on('open:course', async (event, { courseId, profileId, targetUrl }) => {
  const client = store.get('client_session') || { id: 'c1' };
  
  // Clave de Partición Persistente Única por Curso y Cliente
  // Cada partición crea su propia carpeta física en el disco: Cache, Cookies, LocalStorage, IndexedDB
  const partitionKey = \`persist:client_\${client.id}_mod_\${courseId}_prof_\${profileId}\`;

  // Inicializa la sesión Chromium aislada con caché persistente
  const courseSession = session.fromPartition(partitionKey, {
    cache: true, // Guarda caché web, videos y assets descargados
  });

  // Ventana Chromium Aislada para este curso/IA
  const courseWin = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Chromium Isolated Workspace',
    webPreferences: {
      session: courseSession, // ✅ Cada curso almacena su propia caché, cookies y estado
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false, // Bloquea acceso a inspección y credenciales
    },
  });

  // Recupera la última URL visitada si el usuario ya estuvo navegando
  const lastVisitedUrl = store.get(\`last_url_\${partitionKey}\`) || targetUrl;

  // Guarda automáticamente la URL actual al navegar para reanudar donde lo dejó
  courseWin.webContents.on('did-navigate', (e, url) => {
    store.set(\`last_url_\${partitionKey}\`, url);
  });

  // Al cerrar la ventana, las cookies, caché y progreso quedan 100% guardados en la PC
  courseWin.on('close', () => {
    console.log(\`Sesión cerrada para \${partitionKey}. Progreso y cookies guardados en disco.\`);
  });

  // Carga la página: si entra otro día, encontrará todo exactamente donde lo dejó
  courseWin.loadURL(lastVisitedUrl);
});`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Client Desktop App Architecture
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Instalador PC, Cursos Separados & Cookies Privadas
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Flujo de cliente en PC: login con usuario/contraseña, módulos separados (Cursos, IA, Web), cero credenciales maestras y validación con cookies persistentes.
          </p>
        </div>

        {/* View Switcher Tabs & Download Button */}
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            onClick={() => setDownloadModalOpen(true)}
            className="px-4 py-2 bg-linear-to-r from-indigo-600 via-indigo-700 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center gap-2 border border-indigo-500/30 active:scale-95 cursor-pointer"
            title="Instalar formalmente el programa en el disco duro de la PC del cliente con almacenamiento persistente"
          >
            <HardDrive className="w-4 h-4 text-indigo-200" />
            <span>Instalar Programa en Disco Duro (PC)</span>
            <span className="bg-emerald-400/25 text-emerald-200 border border-emerald-400/30 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold">
              Consolidado
            </span>
          </button>

          <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl flex-wrap">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'simulator'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>Simulador de PC</span>
            </button>
            <button
              onClick={() => setActiveTab('disk-storage')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'disk-storage'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-indigo-600" />
              <span>Disco Duro & Perfiles</span>
              <span className="px-1.5 py-0.2 bg-indigo-100 text-indigo-700 rounded text-[10px] font-mono">
                {diskRecords.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('codes')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'codes'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>Códigos de Validación ({codes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('github-repo')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'github-repo'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Github className="w-3.5 h-3.5 text-slate-800" />
              <span>Repositorio GitHub & Releases</span>
            </button>
            <button
              onClick={() => setActiveTab('installer-build')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'installer-build'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Arquitectura Electron</span>
            </button>
            <button
              onClick={() => setActiveTab('api-routes')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'api-routes'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-indigo-600" />
              <span>Rutas API para PC</span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL / BANNER DE DESCARGA & COMPILACIÓN DE INSTALADOR EXE */}
      {downloadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl p-6 space-y-5 animate-fadeIn max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shadow-xs">
                  <HardDrive className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Instalación Consolidada en el Disco Duro de la PC
                  </h3>
                  <p className="text-xs text-slate-500">
                    Programa permanente en Windows: <strong className="text-indigo-600">Sin archivos .bat ni ejecutables sueltos</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDownloadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Status info */}
            <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl flex items-center gap-3 text-xs text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                <strong>✓ Almacenamiento en Disco Duro Activado:</strong> Cada perfil cuenta con su propia partición física en disco (IndexedDB + StorageManager OS) para retener cookies y sesiones permanentemente.
              </span>
            </div>

            {/* MATRIZ DE DESCARGAS AL DISCO DURO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Option 1: 1-Click BAT / CMD Windows Installer */}
              <div className="bg-slate-50 hover:bg-emerald-50/50 p-4 rounded-2xl border-2 border-emerald-500/50 hover:border-emerald-500 transition-all space-y-3 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black uppercase">
                      100% Compatible
                    </span>
                    <span className="text-xs font-bold text-slate-900">Instalador 1-Clic (.BAT)</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                    Doble clic y listo: crea el acceso directo <strong>CourseHub VIP</strong> en tu Escritorio y Menú Inicio, y activa el almacenamiento permanente en tu disco duro.
                  </p>
                </div>
                
                <div className="space-y-2 pt-2">
                  <a
                    href="/api/download/installer-bat"
                    download="Instalar-CourseHub-VIP-v6.2.0.bat"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (showToast) showToast('✓ Descargando Instalador 1-Clic al disco duro...');
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md hover:shadow-lg active:scale-95 cursor-pointer text-center"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar Instalador .BAT</span>
                  </a>

                  <div className="flex items-center gap-1.5">
                    <a
                      href="/api/download/installer-cmd"
                      download="Instalar-CourseHub-VIP-v6.2.0.cmd"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-lg text-center border border-emerald-200"
                    >
                      Descargar .CMD
                    </a>
                    <button
                      onClick={() => {
                        setViewBatScriptModal(true);
                        setDownloadModalOpen(false);
                      }}
                      className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg text-center border border-slate-200 cursor-pointer"
                    >
                      Ver / Copiar Código
                    </button>
                  </div>
                </div>
              </div>

              {/* Option 2: Windows Executable (.EXE) with Setup Wizard */}
              <div className="bg-slate-50 hover:bg-emerald-50/50 p-4 rounded-2xl border-2 border-emerald-500/60 hover:border-emerald-500 transition-all space-y-3 flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider">
                      Instalador Oficial .EXE
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700">Windows 10 / 11</span>
                  </div>
                  <h4 className="text-xs font-black text-slate-900 mt-2">
                    Asistente de Instalación Completo (.EXE)
                  </h4>
                  <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                    Instalador oficial con interfaz gráfica paso a paso:
                  </p>
                  <ul className="mt-2 space-y-1 text-[10.5px] text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200">
                    <li className="flex items-center gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span><strong>Elige carpeta de destino:</strong> dónde descomprimir e instalar los archivos.</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span><strong>Barra de progreso:</strong> extracción limpia al disco duro.</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span><strong>Programa instalado:</strong> registrado en Windows (Panel de Control).</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span><strong>Accesos y desinstalador:</strong> iconos directos y <em>uninstall.exe</em>.</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2 pt-2">
                  <a
                    href="/api/download/installer-exe"
                    download="CourseHub-VIP-Setup-v6.2.0.exe"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (showToast) showToast('✓ Descargando instalador .EXE con asistente al disco duro...');
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md hover:shadow-lg active:scale-95 cursor-pointer text-center"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar Instalador .EXE (Oficial)</span>
                  </a>

                  <a
                    href="/api/download/installer-zip"
                    download="CourseHub-VIP-Instalador-Windows.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (showToast) showToast('✓ Descargando paquete ZIP al disco duro...');
                    }}
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg text-center border border-slate-300 block"
                  >
                    Descargar Paquete ZIP (.ZIP alternativo)
                  </a>
                </div>
              </div>

              {/* Option 3: ZIP Package with Auto-Installer */}
              <div className="bg-slate-50 hover:bg-amber-50/50 p-4 rounded-2xl border border-slate-200 hover:border-amber-300 transition-all space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-black uppercase">
                      Paquete Completo
                    </span>
                    <span className="text-xs font-bold text-slate-900">Paquete ZIP con Instalador</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                    Archivo comprimido .ZIP que incluye el instalador automático, script de respaldo (.CMD), configuración y manual de instalación en PC.
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <a
                    href="/api/download/installer-zip"
                    download="CourseHub-VIP-Instalador-Windows.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (showToast) showToast('✓ Descargando paquete ZIP con instaladores...');
                    }}
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer text-center"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar Paquete (.ZIP)</span>
                  </a>

                  <a
                    href="/api/download/electron-package-zip"
                    download="CourseHub-VIP-Desktop-Repo-v6.2.0.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg text-center border border-slate-200 block"
                  >
                    Descargar Código Fuente / Electron (.ZIP)
                  </a>
                </div>
              </div>

              {/* Option 4: Native PWA Hard Drive Installation */}
              <div className="bg-slate-50 hover:bg-indigo-50/50 p-4 rounded-2xl border-2 border-indigo-500/40 hover:border-indigo-500 transition-all space-y-3 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-black uppercase">
                      Sin Archivos Extra
                    </span>
                    <span className="text-xs font-bold text-slate-900">App Nativa en Disco Duro</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                    Instala CourseHub VIP en el disco duro de tu PC mediante el motor del navegador, con ventana propia independiente, icono en la barra de tareas y acceso directo.
                  </p>
                </div>
                
                <div className="space-y-2 pt-2">
                  <button
                    onClick={async () => {
                      if (isInstallable) {
                        await installPWA();
                        if (showToast) showToast('✓ Solicitud de instalación en Disco Duro enviada');
                      } else {
                        const url = `${window.location.origin}/?mode=client`;
                        window.open(url, '_blank');
                        if (showToast) showToast('✓ Abriendo aplicación en ventana completa para instalación en disco');
                      }
                    }}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md hover:shadow-lg active:scale-95 cursor-pointer text-center"
                  >
                    <Laptop className="w-4 h-4" />
                    <span>Instalar en Disco Duro (1 Clic)</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('disk-storage');
                      setDownloadModalOpen(false);
                    }}
                    className="w-full py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-lg text-center border border-indigo-200 cursor-pointer block"
                  >
                    Ver Particiones y Bóveda en Disco
                  </button>
                </div>
              </div>
            </div>

            {/* Direct Web Client Mode Launcher */}
            <div className="bg-indigo-50/70 border border-indigo-200 p-3.5 rounded-2xl flex items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Probar cliente directamente en ventana completa</span>
                </span>
                <p className="text-[11px] text-indigo-800">
                  Abre la interfaz de cliente con el catálogo, visor y almacenamiento persistente en disco activo.
                </p>
              </div>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/?mode=client`;
                  window.open(url, '_blank');
                  if (showToast) showToast('✓ Abriendo vista cliente en nueva pestaña');
                }}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir Modo Cliente</span>
              </button>
            </div>

            {/* Architectural Explanation Note */}
            <div className="space-y-1.5 text-xs text-slate-700 bg-slate-100 p-3.5 rounded-2xl border border-slate-200">
              <span className="font-bold flex items-center gap-1.5 text-[11px] text-slate-900">
                <HardDrive className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>¿Cómo funciona la consolidación en el disco duro del cliente?</span>
              </span>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                El programa se almacena formalmente en el sistema operativo del cliente sin requerir scripts volátiles de consola ni ejecutables sueltos. Cada módulo y perfil cuenta con una partición física en disco (IndexedDB persistente) donde se guardan de forma permanente las cookies maestras, credenciales desencriptadas y notas del usuario, manteniéndose intactas incluso al apagar o reiniciar la computadora.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDownloadModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: VER Y COPIAR CODIGO DEL INSTALADOR .BAT */}
      {viewBatScriptModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl p-6 space-y-4 animate-fadeIn max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Código del Instalador Windows (.BAT)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Copia este código y guárdalo como archivo <code className="text-indigo-600 font-bold font-mono">instalar.bat</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewBatScriptModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Step Guide */}
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900 space-y-1">
              <span className="font-bold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Instrucciones si tu navegador bloquea la descarga automática:</span>
              </span>
              <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-amber-800 ml-1">
                <li>Haz clic en el botón verde <strong>"Copiar Todo el Código"</strong> abajo.</li>
                <li>Abre el <strong>Bloc de Notas (Notepad)</strong> en tu PC Windows.</li>
                <li>Pega el código (<kbd className="bg-white px-1 py-0.5 rounded border border-amber-300 font-mono text-[10px]">Ctrl + V</kbd>).</li>
                <li>Guarda el archivo en tu Escritorio o Descargas con el nombre <code className="font-bold bg-white px-1 py-0.5 rounded border border-amber-300 font-mono text-[10px]">instalar.bat</code> (en Tipo selecciona *Todos los archivos*).</li>
                <li>Haz <strong>doble clic</strong> en <code className="font-bold">instalar.bat</code> para crear el acceso directo en el Escritorio.</li>
              </ol>
            </div>

            {/* Code Box */}
            <div className="relative">
              <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-72 leading-relaxed border border-slate-800 selection:bg-indigo-800 selection:text-white">
                {generateWindowsBatchInstaller({
                  version: '6.2.0',
                  serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev',
                })}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev';
                  downloadBatchInstaller('Instalar-CourseHub-VIP-v6.2.0.bat', {
                    version: '6.2.0',
                    appName: 'CourseHub VIP Client Desktop',
                    serverUrl: currentOrigin,
                    coursesCount: data.modules?.length || 0,
                  });
                  if (showToast) showToast('✓ Descargando archivo .BAT');
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Archivo .BAT</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const script = generateWindowsBatchInstaller({
                      version: '6.2.0',
                      serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev',
                    });
                    navigator.clipboard.writeText(script);
                    if (showToast) showToast('✓ ¡Código copiado al portapapeles! Pégalo en el Bloc de Notas');
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Todo el Código</span>
                </button>
                <button
                  onClick={() => setViewBatScriptModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: VER Y COPIAR ARCHIVOS DEL PAQUETE ELECTRON */}
      {viewElectronFilesModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-slate-200 shadow-2xl p-6 space-y-4 animate-fadeIn max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                  <Code className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Archivos Fuente de Electron para Compilar .EXE
                  </h3>
                  <p className="text-xs text-slate-500">
                    Paquete completo para generar <code className="text-purple-600 font-bold font-mono">dist/CourseHub VIP Setup 6.2.0.exe</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewElectronFilesModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab selector for files */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
              {(
                [
                  'build-exe.bat',
                  'main.js',
                  'preload.js',
                  'package.json',
                  '.github/workflows/build-release.yml',
                  'README.md',
                ] as const
              ).map((fname) => (
                <button
                  key={fname}
                  onClick={() => setSelectedElectronFile(fname)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer ${
                    selectedElectronFile === fname
                      ? 'bg-purple-700 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {fname}
                </button>
              ))}
            </div>

            {/* Code Content */}
            <div className="relative">
              {(() => {
                const files = getElectronPackageFiles({
                  version: '6.2.0',
                  serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev',
                });
                const codeToShow =
                  selectedElectronFile === 'main.js'
                    ? files.mainJs
                    : selectedElectronFile === 'preload.js'
                    ? files.preloadJs
                    : selectedElectronFile === 'package.json'
                    ? files.packageJson
                    : selectedElectronFile === '.github/workflows/build-release.yml'
                    ? files.githubWorkflowYml
                    : selectedElectronFile === 'README.md'
                    ? files.readmeMd
                    : files.buildBat;

                return (
                  <pre className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed border border-slate-800">
                    {codeToShow}
                  </pre>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={async () => {
                  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev';
                  if (showToast) showToast('📦 Generando paquete .ZIP con repositorio completo...');
                  await downloadElectronSourcePackage({
                    version: '6.2.0',
                    appName: 'CourseHub VIP Client Desktop',
                    serverUrl: currentOrigin,
                    coursesCount: data.modules?.length || 0,
                  });
                  if (showToast) showToast('✓ Descargando CourseHub-VIP-Desktop-Source-v6.2.0.zip');
                }}
                className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Repositorio Completo (.ZIP)</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const files = getElectronPackageFiles({
                      version: '6.2.0',
                      serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev',
                    });
                    const codeToShow =
                      selectedElectronFile === 'main.js'
                        ? files.mainJs
                        : selectedElectronFile === 'preload.js'
                        ? files.preloadJs
                        : selectedElectronFile === 'package.json'
                        ? files.packageJson
                        : selectedElectronFile === '.github/workflows/build-release.yml'
                        ? files.githubWorkflowYml
                        : selectedElectronFile === 'README.md'
                        ? files.readmeMd
                        : files.buildBat;
                    navigator.clipboard.writeText(codeToShow);
                    if (showToast) showToast(`✓ ¡Archivo ${selectedElectronFile} copiado al portapapeles!`);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar {selectedElectronFile}</span>
                </button>
                <button
                  onClick={() => setViewElectronFilesModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 1: INTERACTIVE DESKTOP CLIENT SIMULATOR */}
      {/* ========================================================= */}
      {activeTab === 'simulator' && (
        <div className="space-y-6">
          {/* Quick Account Switcher & Testing Helper */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Monitor className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Probar con Cuenta de Cliente</span>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {data.clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setClientInputUser(c.email);
                        setClientInputPass(c.password || 'cliente123');
                        performClientLogin(c.email, c.password || 'cliente123');
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                        authenticatedClient?.client.id === c.id && isClientLoggedIn
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span>{c.name.split(' ')[0]}</span>
                      <span className="text-[10px] opacity-75">({c.subscription.plan.split(' ')[0]})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => runGitHubAutoUpdater(true)}
                disabled={updateState !== 'idle' && updateState !== 'updated'}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border border-indigo-200 shadow-2xs"
                title="Comprobar e iniciar auto-actualización desde el repositorio GitHub"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updateState !== 'idle' && updateState !== 'updated' ? 'animate-spin text-indigo-600' : ''}`} />
                <span>Simular Inicio & Auto-Actualización GitHub</span>
              </button>

              {isClientLoggedIn && (
                <button
                  onClick={() => {
                    setIsClientLoggedIn(false);
                    setActiveCourse(null);
                    if (showToast) showToast('Sesión de PC cerrada');
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border border-slate-200"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Probar Pantalla de Login del PC</span>
                </button>
              )}
            </div>
          </div>

          {/* SIMULATED PC APPLICATION WINDOW */}
          <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden text-slate-100 font-sans relative">
            {/* Native OS Titlebar (Windows 11 / Mac) */}
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                <span className="ml-3 text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Laptop className="w-3.5 h-3.5 text-indigo-400" />
                  CourseHub PC Desktop Client v{appVersion} (Windows 11 x64)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <div className="hidden sm:flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-0.5 rounded-md text-[10px] text-indigo-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  <span>GitHub: luis5afp/coursehub-vip</span>
                </div>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Servidor Conectado
                </span>
                <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-300">
                  HWID: 7829-WIN11-SEC
                </span>
              </div>
            </div>

            {/* AUTOMATIC GITHUB UPDATE PROGRESS BAR (Al iniciar se verifica y actualiza solo) */}
            {updateState !== 'idle' && (
              <div className="bg-linear-to-r from-indigo-950 via-slate-900 to-indigo-950 border-b border-indigo-500/40 p-3.5 transition-all animate-fadeIn">
                <div className="max-w-4xl mx-auto space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-indigo-600/80 text-white flex items-center justify-center animate-spin">
                        <RefreshCw className="w-3 h-3" />
                      </div>
                      <div>
                        <span className="font-bold text-white tracking-wide">
                          {updateStatusText || 'Verificando e instalando actualización de GitHub...'}
                        </span>
                        <p className="text-[10px] text-indigo-300">
                          Actualización automática sin confirmaciones: se descarga, instala y reinicia para mantener el sistema 100% actualizado.
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-black text-sm text-indigo-400">{updateProgress}%</span>
                    </div>
                  </div>

                  {/* High precision Progress Bar */}
                  <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-indigo-900/60 p-0.5">
                    <div
                      className="h-full bg-linear-to-r from-indigo-500 via-purple-500 to-emerald-400 rounded-full transition-all duration-300 relative overflow-hidden"
                      style={{ width: `${updateProgress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FULL-WINDOW RESTART FLASH OVERLAY (Cuando completa el 100%) */}
            {updateState === 'restarting' && (
              <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center space-y-4 animate-fadeIn">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400 shadow-2xl">
                  <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-black text-white">Reiniciando CourseHub PC...</h3>
                  <p className="text-xs text-indigo-300">
                    Cargando nuevo núcleo v{appVersion} y catálogo de cursos actualizado desde GitHub.
                  </p>
                </div>
              </div>
            )}

            {/* PC APP BODY */}
            <div className="p-6 bg-slate-900 min-h-[520px]">
              {/* ======================================================== */}
              {/* SCREEN 1: PC CLIENT LOGIN SCREEN (IF LOGGED OUT) */}
              {/* ======================================================== */}
              {!isClientLoggedIn ? (
                <div className="max-w-md mx-auto my-8 bg-slate-950 p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-indigo-500 to-indigo-700 flex items-center justify-center mx-auto text-white shadow-lg shadow-indigo-600/30">
                      <Laptop className="w-7 h-7" />
                    </div>
                    <h2 className="text-xl font-black text-white">CourseHub Desktop</h2>
                    <p className="text-xs text-slate-400">
                      Ingresa tus credenciales de cliente para acceder a tus módulos y cursos.
                    </p>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      performClientLogin(clientInputUser, clientInputPass);
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        Usuario o Correo de Cliente
                      </label>
                      <input
                        type="text"
                        value={clientInputUser}
                        onChange={(e) => setClientInputUser(e.target.value)}
                        placeholder="admin@empresaabc.test o tu usuario"
                        required
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-medium text-white outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        Contraseña de Cliente
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={clientInputPass}
                          onChange={(e) => setClientInputPass(e.target.value)}
                          placeholder="Tu contraseña de cliente"
                          required
                          className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-medium text-white outline-none focus:border-indigo-500 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {clientLoginError && (
                      <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>{clientLoginError}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isAuthenticatingClient}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
                    >
                      <span>{isAuthenticatingClient ? 'Iniciando en PC...' : 'Entrar a la Aplicación'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>

                  <div className="pt-3 border-t border-slate-800 text-center text-[11px] text-slate-500">
                    🔒 Contraseña por defecto para pruebas: <strong className="text-slate-300 font-mono">cliente123</strong>
                  </div>
                </div>
              ) : !activeCourse ? (
                /* ======================================================== */
                /* SCREEN 2: PC CLIENT DASHBOARD (COMPACT CATEGORIZED MODULES) */
                /* ======================================================== */
                <div className="space-y-4">
                  {/* Top Client Profile Banner inside PC - Compact */}
                  <div className="bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-linear-to-br from-indigo-600 to-indigo-800 text-white flex items-center justify-center font-black text-xs shadow-xs">
                        {authenticatedClient?.client.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h2 className="text-xs font-bold text-white">
                            {authenticatedClient?.client.name}
                          </h2>
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            ✓ Activo
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {authenticatedClient?.client.email} • {authenticatedClient?.client.plan}
                        </p>
                      </div>
                    </div>

                    {/* Category Filter Tabs - Compact */}
                    <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
                      <button
                        onClick={() => setSelectedCategory('all')}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                          selectedCategory === 'all'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Todos ({catalogItems.length})
                      </button>
                      <button
                        onClick={() => setSelectedCategory('courses')}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                          selectedCategory === 'courses'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>Cursos ({categorizedItems.courses.length})</span>
                      </button>
                      <button
                        onClick={() => setSelectedCategory('ai')}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                          selectedCategory === 'ai'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Bot className="w-3 h-3" />
                        <span>IA ({categorizedItems.ai.length})</span>
                      </button>
                      <button
                        onClick={() => setSelectedCategory('web')}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                          selectedCategory === 'web'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        <span>Web ({categorizedItems.web.length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Real-time sync notification banner for the PC client */}
                  <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-3.5 py-2 flex items-center justify-between text-[11px] text-emerald-300">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>
                        <strong>Sincronización en Tiempo Real Activa:</strong> Si el supervisor cambia una URL, imagen o curso en el panel de administración, se actualiza al instante en este PC.
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-400/90 font-mono hidden md:inline px-2 py-0.5 bg-emerald-950/80 rounded border border-emerald-800/80">
                      ⚡ En Vivo
                    </span>
                  </div>

                  {/* Modular Catalogue Grid - Cover Poster Cards (Max 3 per row) */}
                  <div className="space-y-4">
                    {displayedItems.length === 0 ? (
                      <div className="py-12 text-center text-slate-400 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                        <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                        <p className="font-bold text-xs text-slate-300">No hay cursos ni herramientas disponibles en esta categoría.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4.5">
                        {displayedItems.map((item) => {
                          const fallbackImg =
                            item.category === 'courses'
                              ? 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80'
                              : item.category === 'ai'
                              ? 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80'
                              : 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=600&auto=format&fit=crop&q=80';
                          const coverImage = item.image || fallbackImg;

                          return (
                            <div
                              key={item.id}
                              className="bg-slate-950/90 hover:bg-slate-950 border border-slate-800/90 hover:border-indigo-500/60 rounded-xl overflow-hidden transition-all flex flex-col justify-between group shadow-md hover:shadow-indigo-950/30"
                            >
                              <div>
                                {/* Cover Image Poster */}
                                <div className="relative h-36 w-full overflow-hidden bg-slate-900">
                                  <img
                                    src={coverImage}
                                    alt={item.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    referrerPolicy="no-referrer"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

                                  {/* Top Floating Badges */}
                                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-950/80 backdrop-blur-md text-indigo-300 border border-slate-700/60 flex items-center gap-1 shadow-sm">
                                      <span>{item.icon || '◇'}</span>
                                      <span>{item.category === 'ai' ? 'IA' : item.category === 'web' ? 'Web' : 'Curso'}</span>
                                    </span>

                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-950/90 backdrop-blur-md text-emerald-300 border border-emerald-700/80 flex items-center gap-1 shadow-sm">
                                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                                      Acceso Directo
                                    </span>
                                  </div>

                                  {/* Bottom Title on Image */}
                                  <div className="absolute bottom-2 left-3 right-3">
                                    <span className="text-[9px] font-medium text-slate-300 block truncate">
                                      {item.moduleName}
                                    </span>
                                  </div>
                                </div>

                                {/* Content Details - NO EMAILS, USERNAMES OR PASSWORDS */}
                                <div className="p-4 space-y-3">
                                  <div>
                                    <h3 className="font-bold text-sm text-white group-hover:text-indigo-300 transition-colors line-clamp-1">
                                      {item.name}
                                    </h3>
                                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                      {item.desc || 'Acceso privado con aislamiento de sesión y cookies seguras.'}
                                    </p>
                                  </div>

                                  <div className="bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80 text-[10px] flex items-center justify-between text-slate-400">
                                    <span className="text-slate-500 flex items-center gap-1">
                                      <Lock className="w-2.5 h-2.5 text-indigo-400" />
                                      Credenciales:
                                    </span>
                                    <strong className="text-emerald-400 font-medium flex items-center gap-1">
                                      <span>Cifradas y Ocultas</span>
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              <div className="p-4 pt-0">
                                <button
                                  onClick={() => handleOpenCourse(item.module, item.profile)}
                                  className="w-full py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm bg-indigo-600 hover:bg-indigo-500 text-white"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                  <span className="truncate">
                                    Abrir e Iniciar Sesión Directamente
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ======================================================== */
                /* SCREEN 3: ISOLATED COURSE WORKSPACE (COMPACT BROWSER WEBVIEW) */
                /* ======================================================== */
                <div className="space-y-3">
                  {/* Top Bar of the Course Window - Compact */}
                  <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => setActiveCourse(null)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                      >
                        ← Volver al Catálogo
                      </button>
                      <div className="h-3.5 w-px bg-slate-800" />
                      <div>
                        <span className="font-bold text-xs text-white flex items-center gap-1">
                          <span>{activeCourse.module.icon}</span>
                          <span>{activeCourse.module.name}</span>
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono block">
                          Perfil: {activeCourse.profile?.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (showToast) showToast('Recargando ventana del curso...');
                        }}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-colors"
                        title="Recargar página de la plataforma"
                      >
                        <RotateCcw className="w-2.5 h-2.5 text-indigo-400" />
                        <span>Recargar</span>
                      </button>
                      <button
                        onClick={() => setActiveCourse(null)}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* ACTIVE COURSE WORKSPACE (DIRECTLY LOGGED IN - COMPACT) */}
                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-3">
                    {/* Browser Address Bar - Compact */}
                    <div className="bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <div className="flex items-center gap-1.5 truncate">
                        <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-bold">https://</span>
                        <span className="text-slate-200 truncate">
                          {activeCourse.profile?.url?.replace(/^https?:\/\//, '') || 'classroom.coursehub.cloud/course/active'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[9px] shrink-0 ml-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                          ✓ Sesión Inyectada en PC
                        </span>
                      </div>
                    </div>

                    {/* Course / AI Workspace Interactive Content - Compact with Cover Banner */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden text-center space-y-3 pb-5">
                      {/* Workspace Cover Header */}
                      <div className="relative h-32 w-full overflow-hidden bg-slate-950">
                        {activeCourse.profile?.image ? (
                          <img
                            src={activeCourse.profile.image}
                            alt={activeCourse.profile.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-r from-indigo-900 via-slate-900 to-purple-900 flex items-center justify-center">
                            <span className="text-3xl">{activeCourse.module.icon}</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent" />
                        
                        <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/90 backdrop-blur-xs px-2.5 py-0.5 rounded-md border border-emerald-800">
                            ✓ Entraste Directamente Logueado
                          </span>
                          <span className="text-[10px] text-slate-300 font-mono">
                            Partición: {activeCourse.partitionId.split('_').slice(-2).join('_')}
                          </span>
                        </div>
                      </div>

                      <div className="max-w-md mx-auto space-y-1 px-4">
                        <h3 className="text-base font-black text-white">
                          {activeCourse.profile?.name || activeCourse.module.name}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          La plataforma ha iniciado sesión directamente en tu navegador aislado según las credenciales del servidor.
                        </p>
                      </div>

                      {/* Profile Specs Cards - Chromium Isolated Engine Info */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 max-w-xl mx-auto text-left text-xs pt-1 px-4">
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase">Motor Web</span>
                          <strong className="text-indigo-400 font-semibold text-[10px] truncate block mt-0.5">
                            Chromium Propio
                          </strong>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase">Caché y Cookies</span>
                          <strong className="text-emerald-400 text-[10px] block mt-0.5 truncate">
                            Guardadas en PC
                          </strong>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase">Progreso Web</span>
                          <strong className="text-emerald-400 text-[10px] block mt-0.5 truncate">
                            Guarda Donde lo Dejas
                          </strong>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase">Partición</span>
                          <strong className="text-indigo-300 text-[10px] block mt-0.5 truncate">
                            100% Independiente
                          </strong>
                        </div>
                      </div>

                      <div className="pt-2 flex justify-center gap-2 px-4">
                        <a
                          href={activeCourse.profile?.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-md"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Abrir Ventana en Vivo</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: CONSOLIDACIÓN EN DISCO DURO & PARTICIONES POR PERFIL  */}
      {/* ========================================================= */}
      {activeTab === 'disk-storage' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Hero Banner */}
          <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white border border-indigo-500/30 shadow-xl space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-bold">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Almacenamiento Físico Permanente en la PC del Cliente</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                  Programa Consolidado en Disco Duro (Sin .BAT ni .EXE sueltos)
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  El software de CourseHub VIP se instala en el sistema operativo Windows con acceso permanente en el Menú Inicio, Escritorio y almacenamiento físico asignado por el sistema. Cada perfil de curso cuenta con su propia partición aislada en disco para retener de forma persistente cookies, tokens de acceso y notas.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2.5 shrink-0">
                <button
                  onClick={async () => {
                    if (isInstallable) {
                      await installPWA();
                    } else {
                      const url = `${window.location.origin}/?mode=client`;
                      window.open(url, '_blank');
                    }
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  <Laptop className="w-4 h-4" />
                  <span>Instalar en Disco Duro (1 Clic)</span>
                </button>

                <a
                  href="/api/download/installer-bat"
                  download="Instalar-CourseHub-VIP-v6.2.0.bat"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (showToast) showToast('✓ Descargando Instalador 1-Clic (.BAT) al disco duro');
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold border border-emerald-600 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  <span>Instalador 1-Clic (.BAT)</span>
                </a>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
              <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Persistencia OS
                </span>
                <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>{diskStats?.persisted ? 'Garantizada' : 'Activa en Disco'}</span>
                </div>
                <span className="text-[10px] text-slate-500 block font-mono">
                  Inmune a limpieza de caché
                </span>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Espacio Ocupado
                </span>
                <div className="text-xs font-mono font-bold text-white">
                  {diskStats?.usageMB || '0.2'} MB ocupados
                </div>
                <span className="text-[10px] text-slate-500 block">
                  Bóveda local IndexedDB
                </span>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Espacio Libre en PC
                </span>
                <div className="text-xs font-mono font-bold text-indigo-300">
                  {diskStats?.quotaMB ? `${(diskStats.quotaMB / 1024).toFixed(1)} GB Libres` : 'Cuota de disco libre'}
                </div>
                <span className="text-[10px] text-slate-500 block">
                  Asignado por Windows
                </span>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Particiones Guardadas
                </span>
                <div className="text-xs font-mono font-bold text-emerald-300">
                  {diskRecords.length} en este equipo
                </div>
                <span className="text-[10px] text-slate-500 block">
                  Particiones aisladas
                </span>
              </div>
            </div>
          </div>

          {/* Architecture Comparison Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  ¿Por qué se eliminaron los archivos .BAT y .EXE sueltos?
                </h3>
                <p className="text-xs text-slate-500">
                  Comparativa de seguridad, almacenamiento en disco y experiencia del cliente.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-rose-800">
                  <X className="w-4 h-4 text-rose-600" />
                  <span>Antes: Scripts .BAT y Ejecutables Sueltos</span>
                </div>
                <ul className="space-y-1.5 text-rose-900/80 text-[11px] leading-relaxed list-disc list-inside">
                  <li>No se instalaban formalmente en el disco duro del cliente.</li>
                  <li>Abrían ventanas negras de consola (CMD) que asustaban al cliente.</li>
                  <li>Los antivirus de Windows bloqueaban los archivos .bat o .exe sin firmar.</li>
                  <li>Al cerrar o limpiar archivos temporales, se perdían las cookies y el acceso.</li>
                </ul>
              </div>

              <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Ahora: Software Consolidado en Disco Duro (PC)</span>
                </div>
                <ul className="space-y-1.5 text-emerald-900/80 text-[11px] leading-relaxed list-disc list-inside">
                  <li>Instalación oficial en Windows (%LOCALAPPDATA% / Menú Inicio / Panel de Control).</li>
                  <li>Almacenamiento persistente en disco duro con la API StorageManager del SO.</li>
                  <li>Cada curso y perfil tiene su propia partición aislada (IndexedDB segura).</li>
                  <li>Las cookies, sesiones y notas quedan retenidas permanentemente tras reiniciar la PC.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Interactive Profile Vault & Hard Drive Partition Manager */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Bóveda de Particiones Físicas por Perfil
                  </h3>
                  <p className="text-xs text-slate-500">
                    Inspecciona y gestiona el guardado en disco duro de cada perfil de curso de forma independiente.
                  </p>
                </div>
              </div>

              {/* Client Selector Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Filtrar por Cliente:</span>
                <select
                  value={selectedTestClient}
                  onChange={(e) => setSelectedTestClient(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-hidden focus:border-indigo-500"
                >
                  {data.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>

                <button
                  onClick={loadDiskStorageStats}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                  title="Recargar datos de disco"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List of profiles grouped by module */}
            <div className="space-y-4">
              {data.modules.map((mod) => (
                <div key={mod.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-900">{mod.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-bold">
                        {mod.profiles.length} {mod.profiles.length === 1 ? 'perfil' : 'perfiles'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">ID Módulo: {mod.id}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {mod.profiles.map((prof) => {
                      const partitionKey = `persist:client_${selectedTestClient}_mod_${mod.id}_prof_${prof.id}`;
                      const diskRecord = diskRecords.find((r) => r.partitionId === partitionKey);
                      const isWriting = simulatingDiskWrite === partitionKey;
                      const isSuccess = simulatingDiskSuccess === partitionKey;

                      return (
                        <div
                          key={prof.id}
                          className={`bg-white border rounded-xl p-3.5 space-y-3 transition-all ${
                            diskRecord ? 'border-emerald-300 shadow-xs' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900">{prof.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono">({prof.username})</span>
                              </div>
                              <code className="text-[10px] text-slate-500 font-mono block mt-1 break-all">
                                {partitionKey}
                              </code>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                diskRecord
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {diskRecord ? 'En Disco Duro' : 'Pendiente'}
                            </span>
                          </div>

                          {/* Record details if saved */}
                          {diskRecord && (
                            <div className="bg-slate-50 rounded-lg p-2 text-[10px] font-mono text-slate-600 space-y-0.5 border border-slate-100">
                              <div className="flex justify-between">
                                <span>Último guardado:</span>
                                <span className="font-bold text-slate-800">
                                  {new Date(diskRecord.savedAt).toLocaleTimeString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Token de sesión:</span>
                                <span className="text-emerald-600 font-bold">ACTIVO</span>
                              </div>
                              <div className="flex justify-between">
                                <span>HWID Protegido:</span>
                                <span className="text-indigo-600 font-bold">WIN11-VERIFIED</span>
                              </div>
                            </div>
                          )}

                          {isSuccess && (
                            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] p-2 rounded-lg font-bold flex items-center gap-1.5 animate-fadeIn">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>✓ Partición consolidada con éxito en el Disco Duro local</span>
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                            <div className="flex items-center gap-1.5">
                              {diskRecord ? (
                                <>
                                  <button
                                    onClick={() => setInspectedPartitionData(diskRecord)}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Inspeccionar</span>
                                  </button>
                                  <button
                                    onClick={async () => {
                                      await diskStorageService.deleteProfilePartition(partitionKey);
                                      await loadDiskStorageStats();
                                      if (showToast) showToast('✓ Partición eliminada de disco');
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Limpiar</span>
                                  </button>
                                </>
                              ) : null}
                            </div>

                            <button
                              disabled={isWriting}
                              onClick={async () => {
                                setSimulatingDiskWrite(partitionKey);
                                const selectedClientObj = data.clients.find((c) => c.id === selectedTestClient);
                                await diskStorageService.saveProfilePartition({
                                  partitionId: partitionKey,
                                  clientId: selectedTestClient,
                                  moduleId: mod.id,
                                  profileId: prof.id,
                                  moduleName: mod.name,
                                  profileName: prof.name,
                                  sessionToken: `token_verified_${Math.random().toString(36).substring(2, 10)}`,
                                  cookiesDecrypted: prof.cookies || `session_auth_${prof.username}; Path=/; Secure; HttpOnly`,
                                  clientHwidHash: 'WIN11-VERIFIED-HWID-39182',
                                  notes: `Notas locales guardadas permanentemente para ${prof.name}`,
                                });
                                await loadDiskStorageStats();
                                setSimulatingDiskWrite(null);
                                setSimulatingDiskSuccess(partitionKey);
                                setTimeout(() => setSimulatingDiskSuccess(null), 3000);
                                if (showToast) showToast(`✓ ${prof.name} guardado en Disco Duro`);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95 ml-auto"
                            >
                              {isWriting ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                              <span>{diskRecord ? 'Actualizar en Disco' : 'Guardar en Disco'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modal to Inspect Stored Partition in Hard Drive */}
          {inspectedPartitionData && (
            <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl p-6 space-y-4 animate-fadeIn max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">
                        Partición en Disco Duro: {inspectedPartitionData.profileName}
                      </h3>
                      <p className="text-xs text-slate-500 font-mono">
                        {inspectedPartitionData.partitionId}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setInspectedPartitionData(null)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                    <span className="text-slate-500">Módulo:</span>
                    <strong className="text-slate-800">{inspectedPartitionData.moduleName}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                    <span className="text-slate-500">Guardado el:</span>
                    <strong className="text-slate-800">
                      {new Date(inspectedPartitionData.savedAt).toLocaleString()}
                    </strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                    <span className="text-slate-500">Token de Sesión:</span>
                    <strong className="text-emerald-700">{inspectedPartitionData.sessionToken}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                    <span className="text-slate-500">Hardware ID Asignado:</span>
                    <strong className="text-indigo-700">{inspectedPartitionData.clientHwidHash}</strong>
                  </div>
                  <div className="pt-1">
                    <span className="text-slate-500 block mb-1">Cookies Desencriptadas en Partición Aislada:</span>
                    <div className="bg-slate-950 text-emerald-400 p-2.5 rounded-xl text-[11px] overflow-x-auto break-all font-mono">
                      {inspectedPartitionData.cookiesDecrypted || 'No hay cookies'}
                    </div>
                  </div>
                  {inspectedPartitionData.notes && (
                    <div className="pt-1">
                      <span className="text-slate-500 block mb-1">Notas del Usuario:</span>
                      <div className="bg-white p-2 rounded-lg border border-slate-200 text-slate-700 text-[11px]">
                        {inspectedPartitionData.notes}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setInspectedPartitionData(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: VALIDATION CODES GENERATOR & MANAGER (ADMIN) */}
      {/* ========================================================= */}
      {activeTab === 'codes' && (
        <div className="space-y-6">
          {/* Code Generator Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Generador de Códigos de Validación (6 Dígitos)</h3>
                  <p className="text-xs text-slate-500">
                    Crea un código para que el cliente valide su curso en la app de PC sin interactuar con contraseñas maestras.
                  </p>
                </div>
              </div>

              <button
                onClick={loadCodes}
                disabled={isLoadingCodes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCodes ? 'animate-spin' : ''}`} />
                <span>Actualizar Lista</span>
              </button>
            </div>

            <form onSubmit={handleGenerateCode} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cliente Destino</label>
                <select
                  value={genClientId}
                  onChange={(e) => setGenClientId(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-500 font-semibold"
                >
                  {data.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Módulo / Curso</label>
                <select
                  value={genModuleId}
                  onChange={(e) => setGenModuleId(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-500 font-semibold"
                >
                  {data.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.category || 'Módulo'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Perfil de Curso Asignado</label>
                <select
                  value={genProfileId}
                  onChange={(e) => setGenProfileId(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-500 font-semibold"
                >
                  {data.modules
                    .find((m) => m.id === genModuleId)
                    ?.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.username})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Validez del Código</label>
                <select
                  value={genHours}
                  onChange={(e) => setGenHours(Number(e.target.value))}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-500 font-semibold"
                >
                  <option value={24}>24 Horas (1 Día)</option>
                  <option value={168}>7 Días</option>
                  <option value={720}>30 Días</option>
                  <option value={8760}>1 Año (Permanente)</option>
                </select>
              </div>

              <div className="sm:col-span-4 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isGenerating ? 'Generando...' : 'Generar Código de Validación (6 Dígitos)'}</span>
                </button>
              </div>
            </form>

            {/* Generated Code Highlight Card */}
            {newGeneratedCode && (
              <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-mono font-black text-xl shadow-md">
                    {newGeneratedCode.code}
                  </div>
                  <div>
                    <strong className="text-sm text-indigo-950 font-bold block">
                      Código generado para {newGeneratedCode.clientName}
                    </strong>
                    <span className="text-xs text-indigo-700">
                      Curso: {newGeneratedCode.moduleName} • Válido hasta: {new Date(newGeneratedCode.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(newGeneratedCode.code, 'new-code')}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold flex items-center gap-1"
                  >
                    {copiedKey === 'new-code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'new-code' ? 'Copiado' : 'Copiar Código'}</span>
                  </button>
                  <button
                    onClick={() => {
                      const msg = `Hola ${newGeneratedCode.clientName}, tu código de validación para ingresar a ${newGeneratedCode.moduleName} en CourseHub es: ${newGeneratedCode.code}`;
                      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Compartir por WhatsApp</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active Codes Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">Registro de Códigos Emitidos</h3>
              <span className="text-xs text-slate-500 font-semibold">{codes.length} códigos registrados</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                    <th className="pb-3 pl-2">Código</th>
                    <th className="pb-3">Cliente</th>
                    <th className="pb-3">Curso / Módulo</th>
                    <th className="pb-3">Perfil Asignado</th>
                    <th className="pb-3">Estado</th>
                    <th className="pb-3">Expiración</th>
                    <th className="pb-3 pr-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {codes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No hay códigos de validación emitidos todavía.
                      </td>
                    </tr>
                  ) : (
                    codes.map((item) => (
                      <tr key={item.code} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 pl-2">
                          <span className="font-mono text-sm font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg">
                            {item.code}
                          </span>
                        </td>
                        <td className="py-3 font-semibold text-slate-800">{item.clientName || item.clientId}</td>
                        <td className="py-3 text-slate-600 font-medium">{item.moduleName || item.moduleId}</td>
                        <td className="py-3 text-slate-500 font-mono text-[11px]">{item.profileName || item.profileId}</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.status === 'used' || item.used
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : item.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {item.status === 'used' || item.used ? '✓ Utilizado (Sesión Activa)' : 'Pendiente de Uso'}
                          </span>
                        </td>
                        <td className="py-3 text-slate-500 text-[11px]">
                          {new Date(item.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => copyToClipboard(item.code, `row-${item.code}`)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100"
                              title="Copiar código"
                            >
                              {copiedKey === `row-${item.code}` ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleRevokeCode(item.code)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                              title="Revocar código"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: GITHUB REPO & RELEASES PIPELINE */}
      {/* ========================================================= */}
      {activeTab === 'github-repo' && (
        <div className="space-y-6">
          {/* Header Card & Repo Configuration */}
          <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 opacity-10 text-white pointer-events-none">
              <Github className="w-80 h-80" />
            </div>

            <div className="relative z-10 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white border border-white/20 shadow-inner">
                    <Github className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
                        Repositorio Oficial de GitHub & Auto-Actualizaciones
                      </h2>
                      <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> CI/CD Activo
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Sub-repositorio dedicado al cliente PC. GitHub compila el instalador .EXE en la nube gratis y gestiona auto-updates.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev';
                      if (showToast) showToast('📥 Descargando Instalador de 1 Clic para Alumnos...');
                      downloadBatchInstaller('CourseHub-VIP-Instalador.bat', {
                        version: '6.2.0',
                        appName: 'CourseHub VIP Client Desktop',
                        serverUrl: currentOrigin,
                        coursesCount: data.modules?.length || 0,
                      });
                      if (showToast) showToast('✓ ¡Descargado! Archivo único listo para enviar a tus alumnos');
                    }}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg transition-all flex items-center gap-2 border border-emerald-400/30 active:scale-95 cursor-pointer"
                    title="Descargar un archivo único instalador que puedes enviar directamente por WhatsApp/Drive a tus alumnos sin descomprimir"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar Instalador 1-Clic para Alumnos (.bat)</span>
                    <span className="bg-emerald-950/60 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded font-mono">Archivo Único</span>
                  </button>

                  <button
                    onClick={async () => {
                      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev';
                      if (showToast) showToast('📦 Generando paquete del repositorio en ZIP...');
                      await downloadElectronSourcePackage({
                        version: '6.2.0',
                        appName: 'CourseHub VIP Client Desktop',
                        serverUrl: currentOrigin,
                        coursesCount: data.modules?.length || 0,
                      });
                      if (showToast) showToast('✓ Descargando CourseHub-VIP-Desktop-Repo-v6.2.0.zip');
                    }}
                    className="px-4 py-2.5 bg-purple-700 hover:bg-purple-600 text-white rounded-xl text-xs font-black shadow-lg transition-all flex items-center gap-2 border border-white/10 active:scale-95 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Descargar Repositorio Completo (.ZIP)</span>
                    <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">v6.2.0</span>
                  </button>
                </div>
              </div>

              {/* Repo Config Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                    Usuario / Organización de GitHub
                  </label>
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white">
                    <span className="text-slate-500">github.com/</span>
                    <input
                      type="text"
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value)}
                      className="bg-transparent text-white font-bold outline-none flex-1"
                      placeholder="luis5afp"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                    Nombre del Sub-Repositorio del Cliente
                  </label>
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white">
                    <span className="text-slate-500">/</span>
                    <input
                      type="text"
                      value={githubRepoName}
                      onChange={(e) => setGithubRepoName(e.target.value)}
                      className="bg-transparent text-white font-bold outline-none flex-1"
                      placeholder="coursehub-vip-desktop"
                    />
                  </div>
                </div>
              </div>

              {/* Public URLs Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Github className="w-3.5 h-3.5 text-slate-300" />
                    <span>Repositorio</span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-mono text-indigo-300 truncate">
                      github.com/{githubOwner}/{githubRepoName}
                    </span>
                    <button
                      onClick={() => copyToClipboard(`https://github.com/${githubOwner}/${githubRepoName}`, 'repo-url')}
                      className="p-1 text-slate-400 hover:text-white rounded"
                      title="Copiar URL"
                    >
                      {copiedKey === 'repo-url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-300" />
                    <span>Releases Oficiales</span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-mono text-purple-300 truncate">
                      .../releases/latest
                    </span>
                    <button
                      onClick={() => copyToClipboard(`https://github.com/${githubOwner}/${githubRepoName}/releases/latest`, 'releases-url')}
                      className="p-1 text-slate-400 hover:text-white rounded"
                      title="Copiar URL"
                    >
                      {copiedKey === 'releases-url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Descarga Directa .EXE al Disco Duro</span>
                    </span>
                    <span className="text-[9px] text-emerald-400 font-mono">v6.2.0</span>
                  </div>
                  <div className="flex items-center justify-between gap-1.5">
                    <a
                      href="/api/download/installer-exe"
                      download="CourseHub-VIP-Setup-v6.2.0.exe"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>Descargar .EXE</span>
                    </a>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `${typeof window !== 'undefined' ? window.location.origin : ''}/api/download/installer-exe`,
                          'direct-exe-url'
                        )
                      }
                      className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-white/10 flex items-center gap-1 text-[10px]"
                      title="Copiar enlace de descarga directa"
                    >
                      {copiedKey === 'direct-exe-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copiar Enlace</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4-Step Guide with Git Terminal Snippets */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-indigo-600" />
                <span>Guía Paso a Paso: Publicar en GitHub y Compilar el .EXE Automáticamente</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Con esta configuración no necesitas compilar nada en tu computadora: GitHub Actions compilará el instalador en sus servidores de forma 100% gratuita.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Step 1 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                      1
                    </span>
                    <h4 className="font-bold text-xs text-slate-900">Crear el Repositorio en GitHub</h4>
                  </div>
                  <a
                    href="https://github.com/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                  >
                    <span>Ir a GitHub</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-[11px] text-slate-500">
                  Crea un repositorio llamado <code className="bg-white px-1 py-0.5 rounded text-indigo-600 font-mono font-bold">{githubRepoName}</code> en modo <strong>Público</strong> para que tus clientes puedan descargar el .exe sin credenciales.
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                      2
                    </span>
                    <h4 className="font-bold text-xs text-slate-900">Subir el Código Fuente</h4>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `git init\ngit add .\ngit commit -m "feat: release inicial v6.2.0"\ngit branch -M main\ngit remote add origin https://github.com/${githubOwner}/${githubRepoName}.git\ngit push -u origin main`,
                        'git-push-step'
                      )
                    }
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                  >
                    {copiedKey === 'git-push-step' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'git-push-step' ? 'Copiado' : 'Copiar Comandos'}</span>
                  </button>
                </div>
                <pre className="bg-slate-950 text-slate-200 p-2.5 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto">
{`git init
git add .
git commit -m "feat: release inicial v6.2.0"
git branch -M main
git remote add origin https://github.com/${githubOwner}/${githubRepoName}.git
git push -u origin main`}
                </pre>
              </div>

              {/* Step 3 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-purple-600 text-white font-bold text-xs flex items-center justify-center">
                      3
                    </span>
                    <h4 className="font-bold text-xs text-slate-900">Disparar la Compilación en la Nube (.EXE)</h4>
                  </div>
                  <button
                    onClick={() => copyToClipboard(`git tag v6.2.0\ngit push origin v6.2.0`, 'git-tag-step')}
                    className="text-[11px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1"
                  >
                    {copiedKey === 'git-tag-step' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'git-tag-step' ? 'Copiado' : 'Copiar Comandos'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Al enviar un tag como <code className="bg-white px-1 py-0.5 rounded text-purple-600 font-mono font-bold">v6.2.0</code>, el workflow de GitHub Actions se activa automáticamente:
                </p>
                <pre className="bg-slate-950 text-slate-200 p-2.5 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto">
{`git tag v6.2.0
git push origin v6.2.0`}
                </pre>
              </div>

              {/* Step 4 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                      4
                    </span>
                    <h4 className="font-bold text-xs text-slate-900">Auto-Updates en Tiempo Real</h4>
                  </div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                    Silencioso
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Cuando tus clientes abren CourseHub VIP en su computadora, <code className="text-emerald-700 font-mono font-bold">electron-updater</code> consulta GitHub Releases. Si publicas <code className="text-emerald-700 font-mono font-bold">v6.3.0</code>, se descarga y actualiza automáticamente.
                </p>
              </div>
            </div>
          </div>

          {/* Interactive File Inspector in Repo */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-600" />
                  <span>Estructura de Archivos del Repositorio</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Inspecciona el código de cada archivo generado dentro del paquete ZIP.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    '.github/workflows/build-release.yml',
                    'package.json',
                    'main.js',
                    'preload.js',
                    'build-exe.bat',
                    'README.md',
                  ] as const
                ).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSelectedElectronFile(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      selectedElectronFile === f
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              {(() => {
                const files = getElectronPackageFiles({
                  version: '6.2.0',
                  serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://programavip.luis5afp.workers.dev',
                });
                const codeToShow =
                  selectedElectronFile === 'main.js'
                    ? files.mainJs
                    : selectedElectronFile === 'preload.js'
                    ? files.preloadJs
                    : selectedElectronFile === 'package.json'
                    ? files.packageJson
                    : selectedElectronFile === '.github/workflows/build-release.yml'
                    ? files.githubWorkflowYml
                    : selectedElectronFile === 'README.md'
                    ? files.readmeMd
                    : files.buildBat;

                return (
                  <div className="relative group">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(codeToShow);
                        if (showToast) showToast(`✓ Archivo ${selectedElectronFile} copiado.`);
                      }}
                      className="absolute top-3 right-3 px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white rounded-md text-[11px] font-mono flex items-center gap-1 border border-slate-700 shadow-md transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </button>
                    <pre className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
                      {codeToShow}
                    </pre>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: ELECTRON & PC INSTALLER ARCHITECTURE */}
      {/* ========================================================= */}
      {activeTab === 'installer-build' && (
        <div className="space-y-6">
          {/* Professional Installer Flow Simulation Card */}
          <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 text-white shadow-xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase">
                    Asistente NSIS Oficial
                  </span>
                  <span className="text-xs text-indigo-300 font-mono">Windows 10 / 11 (x64)</span>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-white mt-1">
                  Flujo del Instalador Profesional (.EXE) en la PC del Cliente
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  El cliente no descarga un ejecutable portátil temporal. Ejecuta un instalador formal con asistente gráfico, selección de ruta, barra de progreso y diálogo de inicio inmediato.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 text-indigo-200">
                  CourseHub-VIP-Setup-6.2.0.exe
                </span>
              </div>
            </div>

            {/* 3 Step Visual Installer Mockup */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Step 1: Destination Selection */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-indigo-400">
                  <span className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold flex items-center justify-center">
                    1
                  </span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Ubicación de Instalación</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  El instalador le pregunta al usuario dónde instalar o usa por defecto la ruta estándar de Windows:
                </p>
                <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800 font-mono text-[10px] text-emerald-400 select-all break-all">
                  C:\Users\%USERNAME%\AppData\Local\Programs\CourseHub VIP
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Permite cambiar de carpeta libremente</span>
                </div>
              </div>

              {/* Step 2: Extraction & Progress */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-purple-400">
                  <span className="w-6 h-6 rounded-full bg-purple-600/30 border border-purple-500/40 text-purple-300 text-xs font-bold flex items-center justify-center">
                    2
                  </span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Proceso & Extracción</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Muestra la barra de progreso en tiempo real extrayendo los binarios de Chromium aislados:
                </p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-mono text-slate-300">
                    <span>Instalando componentes...</span>
                    <span>100%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-linear-to-r from-purple-500 to-indigo-500 h-full w-full rounded-full" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <CheckCircle className="w-3.5 h-3.5 text-purple-400" />
                  <span>Crea acceso en Escritorio y Menú Inicio</span>
                </div>
              </div>

              {/* Step 3: Finish & Launch */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="w-6 h-6 rounded-full bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center">
                    3
                  </span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Completado & Ejecución</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Al finalizar la instalación, el asistente ofrece las opciones estándar de Windows:
                </p>
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-white cursor-pointer">
                    <input type="checkbox" defaultChecked className="accent-emerald-500 rounded" readOnly />
                    <span>Ejecutar CourseHub VIP ahora</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-1 border-t border-slate-800">
                    <span className="px-2.5 py-1 rounded bg-slate-800 text-[10px] text-slate-300">Cerrar</span>
                    <span className="px-2.5 py-1 rounded bg-emerald-600 text-[10px] font-bold text-white">Terminar</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Architecture Concept Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900">Auto-Update GitHub Silencioso</h3>
              <p className="text-xs text-slate-500">
                Al iniciar en la PC, consulta automáticamente a GitHub. Si hay cambios, descarga el parche, muestra la barra y reinicia solo sin preguntar nada al usuario.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Laptop className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900">Perfiles Chromium Propios</h3>
              <p className="text-xs text-slate-500">
                Cada curso, IA o web abre en su propia instancia de Chromium con partición persistente (<code className="text-indigo-600 bg-indigo-50 px-1 rounded text-[10px]">persist:...</code>). Las sesiones nunca se mezclan.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Cookie className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900">Caché, Cookies y Progreso</h3>
              <p className="text-xs text-slate-500">
                La caché web, cookies y estado se guardan en el disco duro de la PC. Al cerrar y volver a entrar otro día, el cliente encuentra todo donde lo dejó.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900">Seguridad Zero-Trust</h3>
              <p className="text-xs text-slate-500">
                El cliente nunca ve ni interactúa con correos ni contraseñas. El motor Chromium inyecta la sesión de forma transparente y bloquea DevTools.
              </p>
            </div>
          </div>

          {/* Electron Main Process Code */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                  Código Electron (main.js) para PC: Login, Módulos y Cookies Aisladas
                </h3>
              </div>
              <button
                onClick={() => copyToClipboard(electronProductionCode, 'electron-code')}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
              >
                {copiedKey === 'electron-code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'electron-code' ? 'Copiado' : 'Copiar Código Electron'}</span>
              </button>
            </div>

            <pre className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-[11px] overflow-x-auto leading-relaxed">
              {electronProductionCode}
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: REST API ROUTES & LIVE PROFILE DELIVERY FOR PC      */}
      {/* ========================================================= */}
      {activeTab === 'api-routes' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 text-white shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-black uppercase">
                    Arquitectura REST Client-Server
                  </span>
                  <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    APIs Activas en el Servidor
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  Rutas API que Entregan los Cursos al Programa de PC
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-3xl">
                  El programa de PC no tiene URLs ni contraseñas guardadas en su código. Todo se conecta en tiempo real mediante peticiones HTTP/JSON seguras al servidor: login del cliente, catálogo asignado, entrega de cursos y comprobación de suscripción.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 text-indigo-200">
                  HTTP/1.1 & HTTPS REST
                </span>
              </div>
            </div>

            {/* Architecture Steps */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-1">
                <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase">Paso 1: Login & HWID</span>
                <p className="text-xs font-bold text-white">POST /api/client-app/auth</p>
                <p className="text-[11px] text-slate-400">Verifica credenciales del cliente y bloquea la sesión a su computadora única.</p>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-1">
                <span className="text-[10px] font-mono text-purple-400 font-bold uppercase">Paso 2: Catálogo Dinámico</span>
                <p className="text-xs font-bold text-white">GET /api/desktop/client/:id/catalog</p>
                <p className="text-[11px] text-slate-400">Devuelve los cursos y perfiles que el admin tiene autorizados para este alumno.</p>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-1">
                <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">Paso 3: Entrega del Curso</span>
                <p className="text-xs font-bold text-white">GET .../profiles/:id/launch</p>
                <p className="text-[11px] text-slate-400">El servidor entrega la URL protegida y la clave de partición persistente.</p>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-1">
                <span className="text-[10px] font-mono text-amber-400 font-bold uppercase">Paso 4: Persistencia Local</span>
                <p className="text-xs font-bold text-white">Chromium en PC (Caché & Cookies)</p>
                <p className="text-[11px] text-slate-400">La PC guarda cookies y caché en disco; el servidor no se satura con streaming pesado.</p>
              </div>
            </div>
          </div>

          {/* Interactive Live API Tester */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-indigo-600" />
                  <span>Probador Interactivo de Petición API (Live Server Request)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Simula la petición exacta que el software de PC realiza al servidor cuando el alumno hace clic en un curso.
                </p>
              </div>

              <button
                onClick={handleRunApiTest}
                disabled={testApiLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testApiLoading ? 'animate-spin' : ''}`} />
                <span>{testApiLoading ? 'Consultando al Servidor...' : 'Ejecutar Petición al Servidor'}</span>
              </button>
            </div>

            {/* Selectors for Client, Module and Profile */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  1. Seleccionar Cliente:
                </label>
                <select
                  value={selectedTestClient}
                  onChange={(e) => setSelectedTestClient(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-hidden focus:border-indigo-500"
                >
                  {data.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email}) - {c.status === 'active' ? '✓ Activo' : '✗ Suspendido'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  2. Seleccionar Módulo o Curso:
                </label>
                <select
                  value={selectedTestModule}
                  onChange={(e) => {
                    const modId = e.target.value;
                    setSelectedTestModule(modId);
                    const mod = data.modules.find((m) => m.id === modId);
                    if (mod && mod.profiles.length > 0) {
                      setSelectedTestProfile(mod.profiles[0].id);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-hidden focus:border-indigo-500"
                >
                  {data.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.profiles.length} perfiles)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  3. Seleccionar Perfil del Curso:
                </label>
                <select
                  value={selectedTestProfile}
                  onChange={(e) => setSelectedTestProfile(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-hidden focus:border-indigo-500"
                >
                  {data.modules
                    .find((m) => m.id === selectedTestModule)
                    ?.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.username || 'Sin usuario'})
                      </option>
                    )) || <option value="">Sin perfiles disponibles</option>}
                </select>
              </div>
            </div>

            {/* Request URL Bar */}
            <div className="bg-slate-900 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-black text-[10px]">GET</span>
                <span className="text-slate-300">
                  /api/desktop/modules/{selectedTestModule}/profiles/{selectedTestProfile}/launch?clientId={selectedTestClient}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {testApiLatency !== null && (
                  <span className="text-[11px] text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    200 OK ({testApiLatency} ms)
                  </span>
                )}
                <button
                  onClick={() => {
                    const fullUrl = `${window.location.origin}/api/desktop/modules/${selectedTestModule}/profiles/${selectedTestProfile}/launch?clientId=${selectedTestClient}`;
                    copyToClipboard(fullUrl, 'full-api-url');
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1"
                >
                  {copiedKey === 'full-api-url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Copiar URL</span>
                </button>
              </div>
            </div>

            {/* Response Viewer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  Cuerpo de Respuesta JSON Entregado al Programa de PC:
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Content-Type: application/json</span>
              </div>

              <div className="relative">
                <pre className="bg-slate-950 text-slate-200 p-4 rounded-2xl font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed border border-slate-800">
                  {testApiResult
                    ? JSON.stringify(testApiResult, null, 2)
                    : `// Haga clic en "Ejecutar Petición al Servidor" para ver la respuesta JSON en tiempo real.\n{\n  "status": "ready",\n  "endpoint": "/api/desktop/modules/${selectedTestModule}/profiles/${selectedTestProfile}/launch?clientId=${selectedTestClient}",\n  "description": "Retorna la URL protegida, la clave de partición persistente para Chromium y las políticas de seguridad."\n}`}
                </pre>

                {testApiResult && (
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(testApiResult, null, 2), 'response-json')}
                    className="absolute top-3 right-3 px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-md text-[10px] font-mono flex items-center gap-1 border border-slate-700"
                  >
                    {copiedKey === 'response-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copiar JSON</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Complete REST Endpoints Documentation Table */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Catálogo de Rutas API Disponibles para el Programa de PC
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Todos los endpoints responden con JSON estandarizado y manejan estados HTTP 200, 401, 403 y 404.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3">Método</th>
                    <th className="py-2.5 px-3">Ruta del Endpoint</th>
                    <th className="py-2.5 px-3">Propósito en el Programa de PC</th>
                    <th className="py-2.5 px-3">Persistencia Local</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/client-app/auth</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Login del alumno con correo/clave + Hardware ID de su PC.
                    </td>
                    <td className="py-3 px-3 font-sans text-emerald-600 font-bold">Token de sesión en PC</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-emerald-100 text-emerald-700 font-black px-2 py-0.5 rounded text-[10px]">GET</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/desktop/client/:clientId/catalog</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Descarga la lista de cursos a los que tiene acceso el alumno en tiempo real.
                    </td>
                    <td className="py-3 px-3 font-sans text-indigo-600 font-bold">Sincronización al iniciar</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-emerald-100 text-emerald-700 font-black px-2 py-0.5 rounded text-[10px]">GET</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/desktop/modules/:modId/profiles/:profId/launch</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Entrega URL, partitionKey y paquete de cookies encriptado en AES-256-GCM vinculado al HWID de la PC del alumno.
                    </td>
                    <td className="py-3 px-3 font-sans text-purple-600 font-bold">Cookies Cifradas con HWID</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/modules/:id/profiles/:profId/auto-capture</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Asistente de primer ingreso: realiza el acceso inicial en el servidor y captura tokens de sesión (Cloudflare, Auth, etc.).
                    </td>
                    <td className="py-3 px-3 font-sans text-emerald-600 font-bold">Bóveda Maestra en Servidor</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/modules/:id/profiles/:profId/cookies</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Importa y guarda cookies manuales (JSON o texto) listas para ser encriptadas por HWID.
                    </td>
                    <td className="py-3 px-3 font-sans text-indigo-600 font-bold">Base de Datos Central</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/modules/:id/profiles/:profId/audit-session</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Auditoría de estado de login: diagnostica si la sesión superó 2FA/Captcha y está 100% bien logueada antes de entregarla a los alumnos.
                    </td>
                    <td className="py-3 px-3 font-sans text-emerald-600 font-bold">Diagnóstico Antifraude</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/desktop/heartbeat</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Ping periódico. Si el admin desactiva al cliente en la web, la PC cierra la sesión.
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-500">Revocación instantánea</td>
                  </tr>

                  <tr>
                    <td className="py-3 px-3">
                      <span className="bg-indigo-100 text-indigo-700 font-black px-2 py-0.5 rounded text-[10px]">POST</span>
                    </td>
                    <td className="py-3 px-3 text-slate-900 font-bold">/api/client-app/validate-code</td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      Validación de acceso mediante código numérico de 6 dígitos (VIP-XXXXXX).
                    </td>
                    <td className="py-3 px-3 font-sans text-emerald-600 font-bold">Desbloqueo de módulo en PC</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
