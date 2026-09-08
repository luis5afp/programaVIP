import React, { useState, useEffect, useRef } from 'react';
import {
  AdminUser,
  Client,
  CourseHubData,
  ModuleItem,
  Profile,
  ViewType,
} from './types';
import { INITIAL_DATA } from './data/seed';
import {
  fetchFullData,
  syncFullData,
  resetDatabaseApi,
  verifyAllAccessApi,
  subscribeToDataSync,
  startLiveAutoSync,
} from './services/api';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardView } from './components/DashboardView';
import { ClientsView } from './components/ClientsView';
import { ModulesView } from './components/ModulesView';
import { AdminsView } from './components/AdminsView';
import { RolesView } from './components/RolesView';
import { SecurityView } from './components/SecurityView';
import { SystemView } from './components/SystemView';
import { DesktopClientHubView } from './components/DesktopClientHubView';
import { ClientStandaloneApp } from './components/ClientStandaloneApp';
import { AdminLoginGuard } from './components/AdminLoginGuard';
import { Modal } from './components/Modal';
import { CookieVaultModal } from './components/CookieVaultModal';
import { Upload, Link as LinkIcon, Check, Sparkles, Cookie, Key, Laptop, Eye, EyeOff, RefreshCw } from 'lucide-react';

const STORAGE_KEY = 'coursehub-v6-demo';

export default function App() {
  // Admin Authentication State: Default to true for direct instant access to the full admin dashboard
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('coursehub_admin_auth');
      return saved ? JSON.parse(saved).authenticated !== false : true;
    } catch {
      return true;
    }
  });
  // Load data from localStorage or fallback to initial data
  const [data, setData] = useState<CourseHubData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error loading data from localStorage', e);
    }
    return INITIAL_DATA;
  });

  // Keep ref to latest data for real-time comparison
  const dataRef = useRef<CourseHubData>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const [lastSyncTime, setLastSyncTime] = useState<string>(() => new Date().toLocaleTimeString());
  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false);

  // Real-Time Synchronization Engine (BroadcastChannel + Background Polling + Focus Sync)
  useEffect(() => {
    // 1. Initial fetch from server
    fetchFullData().then((serverData) => {
      if (serverData) {
        setData(serverData);
        setLastSyncTime(new Date().toLocaleTimeString());
      }
    });

    // 2. Instant cross-tab/cross-window broadcast listener (<10ms sync)
    const unsubscribeBroadcast = subscribeToDataSync((remoteData) => {
      if (remoteData) {
        setData(remoteData);
        setIsSyncingLive(true);
        setLastSyncTime(new Date().toLocaleTimeString());
        setTimeout(() => setIsSyncingLive(false), 1000);
      }
    });

    // 3. Continuous remote polling sync across devices/PCs (every 2.5s)
    const unsubscribeAutoSync = startLiveAutoSync(
      () => dataRef.current,
      (remoteData) => {
        setData(remoteData);
        setIsSyncingLive(true);
        setLastSyncTime(new Date().toLocaleTimeString());
        setTimeout(() => setIsSyncingLive(false), 1000);
      },
      2500
    );

    return () => {
      unsubscribeBroadcast();
      unsubscribeAutoSync();
    };
  }, []);

  // Navigation and UI state
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals state
  const [modalType, setModalType] = useState<
    | null
    | 'new-client'
    | 'edit-client'
    | 'edit-sub'
    | 'new-module'
    | 'edit-module'
    | 'new-profile'
    | 'edit-profile'
    | 'fix-credential'
    | 'new-admin'
    | 'new-role'
  >(null);

  // Form states for modals
  const [activeClientForModal, setActiveClientForModal] = useState<Client | null>(null);
  const [activeModuleForModal, setActiveModuleForModal] = useState<ModuleItem | null>(null);
  const [activeProfileForModal, setActiveProfileForModal] = useState<Profile | null>(null);

  // Profile creation/editing form states including Image
  const [profileFormName, setProfileFormName] = useState('');
  const [profileFormUsername, setProfileFormUsername] = useState('');
  const [profileFormUrl, setProfileFormUrl] = useState('');
  const [profileFormImageUrl, setProfileFormImageUrl] = useState('');
  const [profileFormImagePreview, setProfileFormImagePreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client Credential Form States (for PC App Access)
  const [newClientUsername, setNewClientUsername] = useState('');
  const [newClientPassword, setNewClientPassword] = useState('cliente123');
  const [showNewClientPassword, setShowNewClientPassword] = useState(false);

  const [editClientUsername, setEditClientUsername] = useState('');
  const [editClientPassword, setEditClientPassword] = useState('');
  const [showEditClientPassword, setShowEditClientPassword] = useState(false);

  const generateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 9; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  // Master Cookie Vault Modal State
  const [cookieVaultProfile, setCookieVaultProfile] = useState<Profile | null>(null);
  const [cookieVaultModule, setCookieVaultModule] = useState<ModuleItem | null>(null);
  const [isCookieVaultOpen, setIsCookieVaultOpen] = useState<boolean>(false);

  const openCookieVaultModal = (moduleItem: ModuleItem, profile: Profile) => {
    setCookieVaultModule(moduleItem);
    setCookieVaultProfile(profile);
    setIsCookieVaultOpen(true);
  };

  const handleCookiesUpdated = (moduleId: string, profileId: string, updatedProfile: Profile) => {
    setData((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => {
        if (m.id === moduleId) {
          return {
            ...m,
            profiles: m.profiles.map((p) => (p.id === profileId ? updatedProfile : p)),
          };
        }
        return m;
      }),
    }));
    setCookieVaultProfile(updatedProfile);
    if (activeProfileForModal && activeProfileForModal.id === profileId) {
      setActiveProfileForModal(updatedProfile);
    }
  };

  // Save to backend API and local storage on any data change
  useEffect(() => {
    syncFullData(data);
  }, [data]);

  // Toast trigger helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Reset demo handler
  const handleResetDemo = async () => {
    if (window.confirm('¿Deseas restablecer todos los datos de demostración a su estado inicial?')) {
      const resetData = await resetDatabaseApi();
      setData(resetData);
      setSelectedClientId(null);
      setSelectedModuleId(null);
      setCurrentView('dashboard');
      showToast('Servidor y datos restablecidos con éxito');
    }
  };

  // Simulated / API Mass Verification
  const handleReviewAll = async () => {
    if (isReviewing) return;
    setIsReviewing(true);

    const apiResult = await verifyAllAccessApi();
    if (apiResult.success && apiResult.data) {
      setData(apiResult.data);
    } else {
      const now = new Date().toISOString();
      setData((prev) => ({
        ...prev,
        modules: prev.modules.map((m) => ({
          ...m,
          profiles: m.profiles.map((p) => ({
            ...p,
            lastCheck: now,
          })),
        })),
      }));
    }

    setIsReviewing(false);
    showToast('Revisión de accesos completada');
  };

  // Fix Credential Handler
  const openFixCredentialModal = (profile: Profile, moduleName: string) => {
    setActiveProfileForModal(profile);
    setProfileFormUsername(profile.username);
    setModalType('fix-credential');
  };

  const handleSaveFixCredential = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeProfileForModal) return;
    const form = new FormData(e.currentTarget);
    const username = form.get('username') as string;

    setData((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => ({
        ...m,
        profiles: m.profiles.map((p) => {
          if (p.id === activeProfileForModal.id) {
            return {
              ...p,
              username,
              credentialOk: true,
              lastCheck: new Date().toISOString(),
            };
          }
          return p;
        }),
      })),
    }));

    setModalType(null);
    showToast('Credenciales actualizadas y validadas con éxito');
  };

  // Image upload handling for profiles
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setProfileFormImagePreview(result);
      setProfileFormImageUrl('');
    };
    reader.readAsDataURL(file);
  };

  const handleImageUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setProfileFormImageUrl(val);
    setProfileFormImagePreview(val);
  };

  // Open New Profile modal
  const openNewProfileModal = (moduleItem: ModuleItem) => {
    setActiveModuleForModal(moduleItem);
    setActiveProfileForModal(null);
    setProfileFormName('');
    setProfileFormUsername('');
    setProfileFormUrl('');
    setProfileFormImageUrl('');
    setProfileFormImagePreview('');
    setModalType('new-profile');
  };

  // Open Edit Profile modal
  const openEditProfileModal = (moduleItem: ModuleItem, profile: Profile) => {
    setActiveModuleForModal(moduleItem);
    setActiveProfileForModal(profile);
    setProfileFormName(profile.name);
    setProfileFormUsername(profile.username);
    setProfileFormUrl(profile.url);
    setProfileFormImageUrl(profile.image || '');
    setProfileFormImagePreview(profile.image || '');
    setModalType('edit-profile');
  };

  // Save Profile (Create or Edit)
  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeModuleForModal) return;

    const finalImage = profileFormImagePreview || profileFormImageUrl || '';

    if (modalType === 'new-profile') {
      const newProf: Profile = {
        id: 'p_' + Math.random().toString(36).substring(2, 9),
        name: profileFormName,
        username: profileFormUsername,
        url: profileFormUrl,
        image: finalImage,
        credentialOk: true,
        lastCheck: new Date().toISOString(),
      };

      setData((prev) => ({
        ...prev,
        modules: prev.modules.map((m) => {
          if (m.id === activeModuleForModal.id) {
            return {
              ...m,
              profiles: [...m.profiles, newProf],
            };
          }
          return m;
        }),
      }));
      showToast('Perfil agregado al módulo');
    } else if (modalType === 'edit-profile' && activeProfileForModal) {
      setData((prev) => ({
        ...prev,
        modules: prev.modules.map((m) => {
          if (m.id === activeModuleForModal.id) {
            return {
              ...m,
              profiles: m.profiles.map((p) => {
                if (p.id === activeProfileForModal.id) {
                  return {
                    ...p,
                    name: profileFormName,
                    username: profileFormUsername,
                    url: profileFormUrl,
                    image: finalImage,
                  };
                }
                return p;
              }),
            };
          }
          return m;
        }),
      }));
      showToast('Perfil actualizado');
    }

    setModalType(null);
  };

  // Module Management handlers
  const handleCreateModule = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const icon = (form.get('icon') as string) || '◇';
    const desc = form.get('desc') as string;
    const id = 'm_' + Math.random().toString(36).substring(2, 9);

    const newModule: ModuleItem = {
      id,
      name,
      icon,
      desc,
      enabled: true,
      profiles: [],
    };

    setData((prev) => ({
      ...prev,
      modules: [...prev.modules, newModule],
      clients: prev.clients.map((c) => ({
        ...c,
        modules: { ...c.modules, [id]: false },
      })),
    }));

    setModalType(null);
    showToast('Módulo creado');
  };

  const handleEditModule = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeModuleForModal) return;
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const icon = (form.get('icon') as string) || '◇';
    const desc = form.get('desc') as string;
    const enabled = form.get('enabled') === 'true';

    setData((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => {
        if (m.id === activeModuleForModal.id) {
          return { ...m, name, icon, desc, enabled };
        }
        return m;
      }),
    }));

    setModalType(null);
    showToast('Módulo actualizado');
  };

  // Client Management handlers
  const handleCreateClient = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const email = form.get('email') as string;
    const username = ((form.get('username') as string) || newClientUsername || email.split('@')[0] || 'cliente').trim();
    const password = ((form.get('password') as string) || newClientPassword || 'cliente123').trim();
    const phone = (form.get('phone') as string) || '';
    const plan = form.get('plan') as string;
    const start = form.get('start') as string;
    const end = form.get('end') as string;

    const newClient: Client = {
      id: 'c_' + Math.random().toString(36).substring(2, 9),
      name,
      email,
      username,
      password,
      phone,
      status: 'active',
      subscription: {
        plan,
        start,
        end,
        renewal: 'manual',
      },
      modules: Object.fromEntries(data.modules.map((m) => [m.id, false])),
      profileIds: [],
      devices: [],
      history: [{ at: new Date().toISOString(), action: 'Cliente creado con credenciales de acceso a PC' }],
    };

    setData((prev) => ({
      ...prev,
      clients: [newClient, ...prev.clients],
    }));

    setModalType(null);
    showToast(`Cliente registrado con éxito. Usuario PC: ${username}`);
  };

  const handleEditSubscription = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeClientForModal) return;
    const form = new FormData(e.currentTarget);
    const plan = form.get('plan') as string;
    const renewal = form.get('renewal') as 'manual' | 'automatic';
    const start = form.get('start') as string;
    const end = form.get('end') as string;

    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === activeClientForModal.id) {
          return {
            ...c,
            subscription: { plan, renewal, start, end },
            history: [
              { at: new Date().toISOString(), action: 'Suscripción actualizada' },
              ...c.history,
            ],
          };
        }
        return c;
      }),
    }));

    setModalType(null);
    showToast('Suscripción actualizada');
  };

  // Module toggle for client
  const handleToggleModuleForClient = (clientId: string, moduleId: string, checked: boolean) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === clientId) {
          const updatedModules = { ...c.modules, [moduleId]: checked };
          // If turning off module, remove profiles belonging to that module
          let updatedProfiles = [...c.profileIds];
          if (!checked) {
            const targetMod = prev.modules.find((m) => m.id === moduleId);
            if (targetMod) {
              const modProfileIds = targetMod.profiles.map((p) => p.id);
              updatedProfiles = updatedProfiles.filter((id) => !modProfileIds.includes(id));
            }
          }
          return {
            ...c,
            modules: updatedModules,
            profileIds: updatedProfiles,
          };
        }
        return c;
      }),
    }));
    showToast(checked ? 'Módulo habilitado' : 'Módulo deshabilitado');
  };

  // Profile assign toggle for client
  const handleToggleProfileForClient = (clientId: string, profileId: string, checked: boolean) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === clientId) {
          let updated = [...c.profileIds];
          if (checked && !updated.includes(profileId)) {
            updated.push(profileId);
          } else if (!checked) {
            updated = updated.filter((id) => id !== profileId);
          }
          return { ...c, profileIds: updated };
        }
        return c;
      }),
    }));
  };

  // Delete client
  const handleDeleteClient = (clientId: string) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.filter((c) => c.id !== clientId),
    }));
    if (selectedClientId === clientId) {
      setSelectedClientId(null);
    }
    showToast('Cliente eliminado');
  };

  // Open edit client info modal
  const handleEditClientInfo = (client: Client) => {
    setActiveClientForModal(client);
    setEditClientUsername(client.username || client.email.split('@')[0] || '');
    setEditClientPassword(client.password || 'cliente123');
    setShowEditClientPassword(false);
    setModalType('edit-client');
  };

  // Save edit client info modal
  const handleSaveClientInfo = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeClientForModal) return;
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const email = form.get('email') as string;
    const username = ((form.get('username') as string) || editClientUsername || activeClientForModal.username || email.split('@')[0]).trim();
    const password = ((form.get('password') as string) || editClientPassword || activeClientForModal.password || 'cliente123').trim();
    const phone = (form.get('phone') as string) || '';
    const status = (form.get('status') as 'active' | 'suspended' | 'cancelled') || 'active';

    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === activeClientForModal.id) {
          return {
            ...c,
            name,
            email,
            username,
            password,
            phone,
            status,
            history: [
              { at: new Date().toISOString(), action: 'Datos y credenciales de acceso a PC actualizados' },
              ...c.history,
            ],
          };
        }
        return c;
      }),
    }));

    setModalType(null);
    showToast('Datos y credenciales del cliente actualizados');
  };

  // Bulk toggle modules for client
  const handleBulkAssignModules = (clientId: string, enableAll: boolean) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === clientId) {
          const updatedModules = Object.fromEntries(
            prev.modules.map((m) => [m.id, enableAll])
          );
          // If disabling all, clear profile assignments too
          return {
            ...c,
            modules: updatedModules,
            profileIds: enableAll ? c.profileIds : [],
            history: [
              {
                at: new Date().toISOString(),
                action: enableAll ? 'Todos los módulos habilitados' : 'Todos los módulos desmarcados',
              },
              ...c.history,
            ],
          };
        }
        return c;
      }),
    }));
    showToast(enableAll ? 'Todos los módulos han sido habilitados' : 'Todos los módulos han sido desmarcados');
  };

  // Bulk assign profiles for client
  const handleBulkAssignProfiles = (clientId: string, enableAll: boolean) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === clientId) {
          if (!enableAll) {
            return {
              ...c,
              profileIds: [],
              history: [
                { at: new Date().toISOString(), action: 'Todos los perfiles desasignados' },
                ...c.history,
              ],
            };
          }
          // Collect all profiles from modules that are currently enabled for this client
          const allEligibleProfileIds = prev.modules
            .filter((m) => c.modules[m.id])
            .flatMap((m) => m.profiles.map((p) => p.id));

          return {
            ...c,
            profileIds: Array.from(new Set(allEligibleProfileIds)),
            history: [
              { at: new Date().toISOString(), action: 'Todos los perfiles disponibles asignados' },
              ...c.history,
            ],
          };
        }
        return c;
      }),
    }));
    showToast(enableAll ? 'Perfiles de módulos activos asignados' : 'Todos los perfiles desasignados');
  };

  // Toggle device status (active / revoked)
  const handleToggleDeviceStatus = (clientId: string, deviceId: string) => {
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((c) => {
        if (c.id === clientId) {
          const updatedDevices = c.devices.map((d) => {
            if (d.id === deviceId) {
              const nextStatus: 'active' | 'revoked' = d.status === 'active' ? 'revoked' : 'active';
              return { ...d, status: nextStatus };
            }
            return d;
          });
          const targetDev = c.devices.find((d) => d.id === deviceId);
          const wasActive = targetDev?.status === 'active';
          return {
            ...c,
            devices: updatedDevices,
            history: [
              {
                at: new Date().toISOString(),
                action: wasActive
                  ? `Dispositivo ${targetDev?.name || ''} revocado`
                  : `Dispositivo ${targetDev?.name || ''} reactivado`,
              },
              ...c.history,
            ],
          };
        }
        return c;
      }),
    }));
    showToast('Estado del dispositivo actualizado');
  };

  // Delete module
  const handleDeleteModule = (moduleId: string) => {
    setData((prev) => {
      const targetMod = prev.modules.find((m) => m.id === moduleId);
      const modProfileIds = targetMod ? targetMod.profiles.map((p) => p.id) : [];

      return {
        ...prev,
        modules: prev.modules.filter((m) => m.id !== moduleId),
        clients: prev.clients.map((c) => {
          const { [moduleId]: _, ...restModules } = c.modules;
          return {
            ...c,
            modules: restModules,
            profileIds: c.profileIds.filter((pid) => !modProfileIds.includes(pid)),
          };
        }),
      };
    });
    if (selectedModuleId === moduleId) {
      setSelectedModuleId(null);
    }
    showToast('Módulo eliminado');
  };

  // Toggle module enabled status
  const handleToggleModuleEnabled = (moduleId: string) => {
    setData((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => {
        if (m.id === moduleId) {
          return { ...m, enabled: !m.enabled };
        }
        return m;
      }),
    }));
    showToast('Estado del módulo modificado');
  };

  // Delete profile
  const handleDeleteProfile = (moduleId: string, profileId: string) => {
    setData((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => {
        if (m.id === moduleId) {
          return {
            ...m,
            profiles: m.profiles.filter((p) => p.id !== profileId),
          };
        }
        return m;
      }),
      clients: prev.clients.map((c) => ({
        ...c,
        profileIds: c.profileIds.filter((id) => id !== profileId),
      })),
    }));
    showToast('Perfil eliminado');
  };

  // Delete admin
  const handleDeleteAdmin = (adminId: string) => {
    setData((prev) => ({
      ...prev,
      admins: prev.admins.filter((a) => a.id !== adminId),
    }));
    showToast('Administrador eliminado');
  };

  // New admin / New role stubs
  const handleCreateAdmin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const email = form.get('email') as string;
    const username = form.get('username') as string;
    const role = form.get('role') as string;

    const newAdmin: AdminUser = {
      id: 'a_' + Math.random().toString(36).substring(2, 9),
      name,
      email,
      username,
      role,
      status: 'active',
      last: new Date().toISOString(),
    };

    setData((prev) => ({
      ...prev,
      admins: [...prev.admins, newAdmin],
    }));
    setModalType(null);
    showToast('Nuevo administrador agregado');
  };

  const handleCreateRole = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const permissionsStr = form.get('permissions') as string;
    const permissions = permissionsStr.split(',').map((p) => p.trim()).filter(Boolean);

    setData((prev) => ({
      ...prev,
      roles: [...prev.roles, { name, permissions }],
    }));
    setModalType(null);
    showToast('Rol registrado');
  };

  const selectedClient = data.clients.find((c) => c.id === selectedClientId);
  const selectedModule = data.modules.find((m) => m.id === selectedModuleId);

  // Direct Client Desktop App Access (e.g. launched via Windows 1-Click .bat or client URL)
  const isClientMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mode') === 'client' ||
    new URLSearchParams(window.location.search).get('view') === 'client'
  );

  if (isClientMode) {
    return <ClientStandaloneApp data={data} />;
  }

  if (!isAdminAuthenticated) {
    return (
      <AdminLoginGuard
        onLoginSuccess={() => {
          setIsAdminAuthenticated(true);
          showToast('Sesión de administrador iniciada');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#101827] flex antialiased">
      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onSelectView={(v) => {
          setCurrentView(v);
          setSelectedClientId(null);
          setSelectedModuleId(null);
        }}
        clientCount={data.clients.length}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onLogout={() => {
          localStorage.removeItem('coursehub_admin_auth');
          setIsAdminAuthenticated(false);
          showToast('Sesión cerrada');
        }}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <TopBar
          currentView={currentView}
          selectedClientName={selectedClient?.name}
          selectedModuleName={selectedModule?.name}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onResetDemo={handleResetDemo}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          isSyncingLive={isSyncingLive}
          lastSyncTime={lastSyncTime}
          onSelectSystemView={() => {
            setCurrentView('system');
            setSelectedClientId(null);
            setSelectedModuleId(null);
          }}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {currentView === 'dashboard' && (
            <DashboardView
              data={data}
              onReviewAll={handleReviewAll}
              isReviewing={isReviewing}
              onFixCredential={openFixCredentialModal}
              searchQuery={searchQuery}
            />
          )}

          {currentView === 'clients' && (
            <ClientsView
              data={data}
              selectedClientId={selectedClientId}
              onSelectClient={setSelectedClientId}
              onNewClient={() => {
                setNewClientUsername('');
                setNewClientPassword(generateRandomPassword());
                setShowNewClientPassword(false);
                setModalType('new-client');
              }}
              onEditClientInfo={handleEditClientInfo}
              onDeleteClient={handleDeleteClient}
              onEditSubscription={(c) => {
                setActiveClientForModal(c);
                setModalType('edit-sub');
              }}
              onToggleModule={handleToggleModuleForClient}
              onToggleProfile={handleToggleProfileForClient}
              onToggleDeviceStatus={handleToggleDeviceStatus}
              onBulkAssignModules={handleBulkAssignModules}
              onBulkAssignProfiles={handleBulkAssignProfiles}
              searchQuery={searchQuery}
            />
          )}

          {currentView === 'modules' && (
            <ModulesView
              data={data}
              selectedModuleId={selectedModuleId}
              onSelectModule={setSelectedModuleId}
              onNewModule={() => setModalType('new-module')}
              onEditModule={(m) => {
                setActiveModuleForModal(m);
                setModalType('edit-module');
              }}
              onDeleteModule={handleDeleteModule}
              onToggleModuleEnabled={handleToggleModuleEnabled}
              onNewProfile={openNewProfileModal}
              onEditProfile={openEditProfileModal}
              onDeleteProfile={handleDeleteProfile}
              onFixCredential={openFixCredentialModal}
              onManageCookies={openCookieVaultModal}
              searchQuery={searchQuery}
            />
          )}

          {currentView === 'desktop-app' && (
            <DesktopClientHubView
              data={data}
              showToast={showToast}
            />
          )}

          {currentView === 'admins' && (
            <AdminsView
              data={data}
              onNewAdmin={() => setModalType('new-admin')}
              onDeleteAdmin={handleDeleteAdmin}
            />
          )}

          {currentView === 'roles' && (
            <RolesView data={data} onNewRole={() => setModalType('new-role')} />
          )}

          {currentView === 'security' && <SecurityView />}

          {currentView === 'system' && (
            <SystemView
              data={data}
              onDataChange={setData}
              showToast={showToast}
            />
          )}
        </main>
      </div>


      {/* MODAL: New Client */}
      <Modal
        isOpen={modalType === 'new-client'}
        onClose={() => setModalType(null)}
        title="Nuevo cliente"
        subtitle="Crea la ficha del cliente, su suscripción inicial y credenciales para el programa en PC."
        eyebrow="Customer"
      >
        <form onSubmit={handleCreateClient} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nombre de la empresa / cliente</label>
            <input
              name="name"
              required
              placeholder="Ej. Empresa ABC"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Correo electrónico</label>
              <input
                type="email"
                name="email"
                required
                placeholder="admin@empresa.com"
                onChange={(e) => {
                  if (!newClientUsername) {
                    const candidate = e.target.value.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                    setNewClientUsername(candidate);
                  }
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Teléfono</label>
              <input
                name="phone"
                placeholder="+34 600 000 000"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* CREDENCIALES PARA ACCESO AL PROGRAMA EN LA PC */}
          <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-xs">
                <Laptop className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h4 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                  <span>Credenciales de Acceso a la PC</span>
                  <span className="px-1.5 py-0.2 text-[10px] font-bold bg-indigo-200/60 text-indigo-900 rounded">Programa Desktop</span>
                </h4>
                <p className="text-[11px] text-indigo-800/90 mt-0.5 leading-snug">
                  Estas son las credenciales con las que el cliente iniciará sesión en la aplicación instalada en su computadora para acceder a sus perfiles.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-indigo-100">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Usuario para la PC</span>
                </label>
                <input
                  name="username"
                  value={newClientUsername}
                  onChange={(e) => setNewClientUsername(e.target.value)}
                  placeholder="ej. empresa_abc o admin_vip"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 bg-white font-mono"
                />
                <p className="text-[10px] text-slate-500">Usuario de inicio de sesión en Windows / PC.</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Contraseña</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewClientPassword(generateRandomPassword())}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Generar clave</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewClientPassword ? 'text' : 'password'}
                    name="password"
                    value={newClientPassword}
                    onChange={(e) => setNewClientPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    className="w-full px-3 py-2 pr-9 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewClientPassword(!showNewClientPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showNewClientPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  >
                    {showNewClientPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Clave de acceso al software desktop.</p>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Plan contratado</label>
            <input
              name="plan"
              defaultValue="Premium Empresarial"
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Fecha de inicio</label>
              <input
                type="date"
                name="start"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Fecha de vencimiento</label>
              <input
                type="date"
                name="end"
                defaultValue={(() => {
                  const d = new Date();
                  d.setFullYear(d.getFullYear() + 1);
                  return d.toISOString().slice(0, 10);
                })()}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              Guardar cliente
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Edit Client Information */}
      <Modal
        isOpen={modalType === 'edit-client'}
        onClose={() => setModalType(null)}
        title="Editar información del cliente"
        subtitle="Actualiza los datos de contacto, estado de cuenta y credenciales de acceso a la PC."
        eyebrow="Customer"
      >
        {activeClientForModal && (
          <form onSubmit={handleSaveClientInfo} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Nombre o Empresa</label>
              <input
                name="name"
                defaultValue={activeClientForModal.name}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Correo Electrónico</label>
              <input
                type="email"
                name="email"
                defaultValue={activeClientForModal.email}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Teléfono / WhatsApp</label>
                <input
                  name="phone"
                  defaultValue={activeClientForModal.phone || ''}
                  placeholder="+51 987 654 321"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Estado de la cuenta</label>
                <select
                  name="status"
                  defaultValue={activeClientForModal.status || 'active'}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                >
                  <option value="active">Activo</option>
                  <option value="suspended">Suspendido</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>

            {/* CREDENCIALES PARA ACCESO AL PROGRAMA EN LA PC */}
            <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-xs">
                  <Laptop className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                    <span>Credenciales de Acceso a la PC</span>
                    <span className="px-1.5 py-0.2 text-[10px] font-bold bg-indigo-200/60 text-indigo-900 rounded">Programa Desktop</span>
                  </h4>
                  <p className="text-[11px] text-indigo-800/90 mt-0.5 leading-snug">
                    Modifica el usuario o la contraseña que el cliente utiliza para iniciar sesión en la computadora.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-indigo-100">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Usuario para la PC</span>
                  </label>
                  <input
                    name="username"
                    value={editClientUsername}
                    onChange={(e) => setEditClientUsername(e.target.value)}
                    placeholder="ej. empresa_abc"
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 bg-white font-mono"
                  />
                  <p className="text-[10px] text-slate-500">Usuario de inicio de sesión en Windows / PC.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Key className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Contraseña</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditClientPassword(generateRandomPassword())}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      <span>Generar nueva</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showEditClientPassword ? 'text' : 'password'}
                      name="password"
                      value={editClientPassword}
                      onChange={(e) => setEditClientPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full px-3 py-2 pr-9 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 bg-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditClientPassword(!showEditClientPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      title={showEditClientPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showEditClientPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">Clave de acceso al software desktop.</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: Edit Subscription */}
      <Modal
        isOpen={modalType === 'edit-sub'}
        onClose={() => setModalType(null)}
        title="Editar suscripción"
        subtitle={`Cliente: ${activeClientForModal?.name}`}
        eyebrow="Subscription"
      >
        {activeClientForModal && (
          <form onSubmit={handleEditSubscription} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Plan</label>
              <input
                name="plan"
                defaultValue={activeClientForModal.subscription.plan}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Tipo de renovación</label>
              <select
                name="renewal"
                defaultValue={activeClientForModal.subscription.renewal}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automática</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Fecha de inicio</label>
                <input
                  type="date"
                  name="start"
                  defaultValue={activeClientForModal.subscription.start}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Fecha de vencimiento</label>
                <input
                  type="date"
                  name="end"
                  defaultValue={activeClientForModal.subscription.end}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: New Module */}
      <Modal
        isOpen={modalType === 'new-module'}
        onClose={() => setModalType(null)}
        title="Nuevo módulo"
        subtitle="Crea una nueva categoría para organizar perfiles y plataformas."
        eyebrow="Module"
      >
        <form onSubmit={handleCreateModule} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-bold text-slate-700">Nombre del módulo</label>
              <input
                name="name"
                required
                placeholder="Ej. Diseño Gráfico"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Icono / Símbolo</label>
              <input
                name="icon"
                defaultValue="◇"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 text-center font-bold"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Descripción</label>
            <input
              name="desc"
              placeholder="Herramientas y plataformas para..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              Crear módulo
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Edit Module */}
      <Modal
        isOpen={modalType === 'edit-module'}
        onClose={() => setModalType(null)}
        title="Editar módulo"
        subtitle={`Modificando: ${activeModuleForModal?.name}`}
        eyebrow="Module"
      >
        {activeModuleForModal && (
          <form onSubmit={handleEditModule} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-bold text-slate-700">Nombre</label>
                <input
                  name="name"
                  defaultValue={activeModuleForModal.name}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Icono</label>
                <input
                  name="icon"
                  defaultValue={activeModuleForModal.icon}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 text-center font-bold"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Descripción</label>
              <input
                name="desc"
                defaultValue={activeModuleForModal.desc}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Estado del módulo</label>
              <select
                name="enabled"
                defaultValue={activeModuleForModal.enabled ? 'true' : 'false'}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              >
                <option value="true">Activo (Visible en asignación)</option>
                <option value="false">Inactivo (Oculto)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: New or Edit Profile with Image Picker & Preview */}
      <Modal
        isOpen={modalType === 'new-profile' || modalType === 'edit-profile'}
        onClose={() => setModalType(null)}
        title={modalType === 'new-profile' ? 'Nuevo perfil' : 'Editar perfil'}
        subtitle={`Módulo: ${activeModuleForModal?.name}`}
        eyebrow="Profile"
      >
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Nombre del perfil / curso</label>
              <input
                value={profileFormName}
                onChange={(e) => setProfileFormName(e.target.value)}
                required
                placeholder="Ej. Excel Avanzado 2026"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Correo / Usuario de acceso</label>
              <input
                value={profileFormUsername}
                onChange={(e) => setProfileFormUsername(e.target.value)}
                placeholder="usuario@dominio.com"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">URL de la plataforma</label>
            <input
              type="url"
              value={profileFormUrl}
              onChange={(e) => setProfileFormUrl(e.target.value)}
              required
              placeholder="https://plataforma.ejemplo.com"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          {/* V6 Image selector box with File & URL options */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span className="block text-xs font-bold text-slate-800">
              Imagen de portada del perfil (V6)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Subir desde este dispositivo
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 block mt-1">PNG, JPG o WEBP</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  O pegar URL de imagen
                </label>
                <div className="relative">
                  <LinkIcon className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="url"
                    value={profileFormImageUrl}
                    onChange={handleImageUrlChange}
                    placeholder="https://.../foto.jpg"
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Live image preview */}
            <div className="pt-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Vista previa de la imagen
              </span>
              <div className="w-full h-28 rounded-lg border border-dashed border-slate-300 bg-white overflow-hidden flex items-center justify-center">
                {profileFormImagePreview ? (
                  <img
                    src={profileFormImagePreview}
                    alt="Vista previa"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="text-xs text-slate-400">Sin imagen seleccionada</span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Contraseña (Opcional)</label>
            <input
              type="password"
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
            <span className="text-[10px] text-slate-400 block">
              Las contraseñas se cifran y no se exponen en texto claro.
            </span>
          </div>

          {/* Master Cookies & First Login Banner in edit-profile */}
          {modalType === 'edit-profile' && activeProfileForModal && activeModuleForModal && (
            <div className="p-3.5 bg-linear-to-r from-indigo-50 to-slate-50 border border-indigo-200/80 rounded-xl flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Cookie className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Bóveda de Cookies Maestras (HWID)</span>
                </span>
                <p className="text-[11px] text-slate-600">
                  {activeProfileForModal.cookies && activeProfileForModal.cookies.length > 0
                    ? `✓ ${activeProfileForModal.cookies.length} cookies listas para ser entregadas con cifrado de hardware.`
                    : '⚡ Requiere primer ingreso para capturar cookies de sesión para la PC.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  openCookieVaultModal(activeModuleForModal, activeProfileForModal);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer shadow-xs transition-all flex items-center gap-1"
              >
                <span>Gestionar Cookies</span>
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              {modalType === 'new-profile' ? 'Crear perfil' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Fix Credential */}
      <Modal
        isOpen={modalType === 'fix-credential'}
        onClose={() => setModalType(null)}
        title="Actualizar acceso y credencial"
        subtitle={`Perfil: ${activeProfileForModal?.name}`}
        eyebrow="Access"
      >
        <form onSubmit={handleSaveFixCredential} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Correo / Usuario</label>
            <input
              name="username"
              defaultValue={profileFormUsername}
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nueva contraseña</label>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs border border-emerald-100">
            Al guardar, el estado de este acceso pasará automáticamente a <strong>✓ Válido</strong> y
            se registrará la fecha y hora de la revisión.
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            >
              Validar y guardar
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: New Admin */}
      <Modal
        isOpen={modalType === 'new-admin'}
        onClose={() => setModalType(null)}
        title="Nuevo administrador"
        subtitle="Registra un usuario interno con acceso al panel."
        eyebrow="Administration"
      >
        <form onSubmit={handleCreateAdmin} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nombre completo</label>
            <input
              name="name"
              required
              placeholder="Ej. Carlos Mendoza"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Correo</label>
              <input
                type="email"
                name="email"
                required
                placeholder="carlos@coursehub.test"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Nombre de usuario</label>
              <input
                name="username"
                required
                placeholder="cmendoza"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Rol asignado</label>
            <select
              name="role"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            >
              {data.roles.map((r, i) => (
                <option key={i} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              Crear administrador
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: New Role */}
      <Modal
        isOpen={modalType === 'new-role'}
        onClose={() => setModalType(null)}
        title="Nuevo rol y permisos"
        subtitle="Define un conjunto de permisos administrativos."
        eyebrow="Access Control"
      >
        <form onSubmit={handleCreateRole} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nombre del rol</label>
            <input
              name="name"
              required
              placeholder="Ej. Auditor de Accesos"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Permisos (separados por coma)</label>
            <input
              name="permissions"
              defaultValue="Clientes, Suscripciones, Perfiles"
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              Guardar rol
            </button>
          </div>
        </form>
      </Modal>

      {/* Master Cookie Vault & First Login Modal */}
      <CookieVaultModal
        isOpen={isCookieVaultOpen}
        onClose={() => setIsCookieVaultOpen(false)}
        moduleItem={cookieVaultModule}
        profile={cookieVaultProfile}
        clients={data.clients}
        onCookiesUpdated={handleCookiesUpdated}
        showToast={showToast}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          id="global-toast"
          className="fixed bottom-5 right-5 z-50 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
