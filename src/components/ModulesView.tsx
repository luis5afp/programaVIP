import React from 'react';
import {
  FolderPlus,
  ArrowLeft,
  Plus,
  Edit,
  ExternalLink,
  ShieldAlert,
  Layers,
  Image as ImageIcon,
  Key,
  Trash2,
  CheckCircle2,
  XCircle,
  Lock,
  Cookie,
  Sparkles,
  Cpu,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { CourseHubData, ModuleItem, Profile } from '../types';

interface ModulesViewProps {
  data: CourseHubData;
  selectedModuleId: string | null;
  onSelectModule: (id: string | null) => void;
  onNewModule: () => void;
  onEditModule: (module: ModuleItem) => void;
  onDeleteModule?: (moduleId: string) => void;
  onToggleModuleEnabled?: (moduleId: string) => void;
  onNewProfile: (module: ModuleItem) => void;
  onEditProfile: (module: ModuleItem, profile: Profile) => void;
  onDeleteProfile?: (moduleId: string, profileId: string) => void;
  onFixCredential: (profile: Profile, moduleName: string) => void;
  onManageCookies?: (module: ModuleItem, profile: Profile) => void;
  searchQuery: string;
}

export const ModulesView: React.FC<ModulesViewProps> = ({
  data,
  selectedModuleId,
  onSelectModule,
  onNewModule,
  onEditModule,
  onDeleteModule,
  onToggleModuleEnabled,
  onNewProfile,
  onEditProfile,
  onDeleteProfile,
  onFixCredential,
  onManageCookies,
  searchQuery,
}) => {
  const selectedModule = data.modules.find((m) => m.id === selectedModuleId);

  // If a module is selected, render module detail with all its profiles
  if (selectedModule) {
    const filteredProfiles = selectedModule.profiles.filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q)
      );
    });

    return (
      <div className="space-y-6">
        {/* Module Header / Hero */}
        <div className="p-6 rounded-2xl bg-linear-to-r from-white via-slate-50 to-indigo-50/40 border border-slate-200 shadow-xs">
          <button
            onClick={() => onSelectModule(null)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver a todos los módulos</span>
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-black text-2xl shadow-xs">
                {selectedModule.icon}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                    {selectedModule.name}
                  </h1>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedModule.enabled
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {selectedModule.enabled ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">{selectedModule.desc}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-edit-current-module"
                onClick={() => onEditModule(selectedModule)}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                Editar módulo
              </button>
              {onDeleteModule && (
                <button
                  id="btn-delete-current-module"
                  onClick={() => {
                    if (window.confirm(`¿Estás seguro de que deseas eliminar el módulo "${selectedModule.name}" y todos sus perfiles asociados?`)) {
                      onDeleteModule(selectedModule.id);
                    }
                  }}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Eliminar</span>
                </button>
              )}
              <button
                id="btn-new-profile"
                onClick={() => onNewProfile(selectedModule)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nuevo perfil</span>
              </button>
            </div>
          </div>
        </div>

        {/* Profiles Grid */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Perfiles y Accesos</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedModule.profiles.length} perfiles configurados en esta categoría.
              </p>
            </div>
            <button
              onClick={() => onNewProfile(selectedModule)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar perfil</span>
            </button>
          </div>

          {filteredProfiles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
              Este módulo aún no tiene perfiles configurados. Haz clic en "Nuevo perfil" para agregar
              uno con imagen y credenciales.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {filteredProfiles.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  {/* Profile Cover Image */}
                  <div className="w-full h-36 bg-slate-100 relative overflow-hidden border-b border-slate-200">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-linear-to-br from-indigo-50/50 to-slate-100">
                        <ImageIcon className="w-6 h-6 text-indigo-300 mb-1" />
                        <span className="text-[10px] font-semibold text-slate-400">
                          Sin imagen asignada
                        </span>
                      </div>
                    )}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 flex-wrap justify-end">
                      {p.loginVerificationStatus === 'fully_logged_in' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-700/95 text-white border border-emerald-400/40 shadow-xs backdrop-blur-xs flex items-center gap-1">
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-200" />
                          <span>Bien Logueado</span>
                        </span>
                      ) : p.loginVerificationStatus === 'pending_verification' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/95 text-white shadow-xs backdrop-blur-xs flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>2FA Pendiente</span>
                        </span>
                      ) : p.cookies && p.cookies.length > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900/90 text-emerald-300 border border-emerald-500/40 shadow-xs backdrop-blur-xs flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5 text-emerald-400" />
                          <span>HWID Cifrado ({p.cookies.length})</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-white shadow-xs backdrop-blur-xs flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>1er Ingreso Pendiente</span>
                        </span>
                      )}

                      {p.credentialOk ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/90 text-white shadow-xs backdrop-blur-xs">
                          ✓ Válido
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/90 text-white shadow-xs backdrop-blur-xs">
                          × No válido
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Profile Body */}
                  <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-sm text-slate-900">{p.name}</h3>
                      </div>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline mt-0.5 truncate max-w-full"
                      >
                        <span className="truncate">{p.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        {p.username || 'Sin usuario'}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onManageCookies && (
                          <button
                            onClick={() => onManageCookies(selectedModule, p)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                            title="Gestionar cookies maestras y primer ingreso con blindaje HWID"
                          >
                            <Cookie className="w-3 h-3 text-indigo-600" />
                            <span>Cookies & Sesión</span>
                          </button>
                        )}
                        <button
                          onClick={() => onEditProfile(selectedModule, p)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-colors"
                        >
                          Editar
                        </button>
                        {!p.credentialOk && (
                          <button
                            onClick={() => onFixCredential(p, selectedModule.name)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
                          >
                            Actualizar
                          </button>
                        )}
                        {onDeleteProfile && (
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Eliminar el perfil "${p.name}"?`)) {
                                onDeleteProfile(selectedModule.id, p.id);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Eliminar perfil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Catalog view of all modules
  const filteredModules = data.modules.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Product Catalog
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Módulos Educativos y Herramientas
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Crea módulos de cursos, IA o herramientas y administra los perfiles contenidos en cada
            uno.
          </p>
        </div>
        <div>
          <button
            id="btn-new-module"
            onClick={onNewModule}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Nuevo módulo</span>
          </button>
        </div>
      </div>

      {/* Modules Cards Grid - Compact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {filteredModules.map((m) => (
          <div
            key={m.id}
            className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between hover:border-slate-300 hover:shadow-sm transition-all"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center font-bold text-sm shadow-xs">
                  {m.icon}
                </div>
                <button
                  type="button"
                  onClick={() => onToggleModuleEnabled && onToggleModuleEnabled(m.id)}
                  title="Haz clic para alternar estado"
                  className={`px-2 py-0.5 rounded-full text-[9px] font-bold cursor-pointer transition-all hover:scale-105 ${
                    m.enabled
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200'
                  }`}
                >
                  {m.enabled ? '✓ Activo' : '× Inactivo'}
                </button>
              </div>

              <h3 className="font-bold text-sm text-slate-900 line-clamp-1">{m.name}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 min-h-[32px] line-clamp-2 leading-relaxed">{m.desc}</p>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-medium">{m.profiles.length} perfiles</span>
                <span className="text-[10px] text-slate-400">
                  {m.enabled ? 'Publicado' : 'Oculto'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onEditModule(m)}
                  className="flex-1 px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold transition-colors text-center"
                >
                  Editar
                </button>
                <button
                  id={`manage-module-${m.id}`}
                  onClick={() => onSelectModule(m.id)}
                  className="flex-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition-colors text-center"
                >
                  Perfiles
                </button>
                {onDeleteModule && (
                  <button
                    onClick={() => {
                      if (window.confirm(`¿Eliminar el módulo "${m.name}"?`)) {
                        onDeleteModule(m.id);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 rounded-lg transition-colors"
                    title="Eliminar módulo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
