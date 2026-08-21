import React, { useState } from 'react';
import {
  Users,
  CheckCircle2,
  XCircle,
  Laptop,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { CourseHubData, Profile, ReviewFilterType } from '../types';
import { formatDate } from '../utils/helpers';

interface DashboardViewProps {
  data: CourseHubData;
  onReviewAll: () => void;
  isReviewing: boolean;
  onFixCredential: (profile: Profile, moduleName: string) => void;
  searchQuery: string;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  onReviewAll,
  isReviewing,
  onFixCredential,
  searchQuery,
}) => {
  const [filter, setFilter] = useState<ReviewFilterType>('all');

  // Collect all profiles across modules
  const allProfiles = data.modules.flatMap((m) =>
    m.profiles.map((p) => ({
      ...p,
      moduleId: m.id,
      moduleName: m.name,
    }))
  );

  const activeClientsCount = data.clients.filter((c) => c.status === 'active').length;
  const validCount = allProfiles.filter((p) => p.credentialOk).length;
  const invalidCount = allProfiles.filter((p) => !p.credentialOk).length;
  const activeDevicesCount = data.clients
    .flatMap((c) => c.devices)
    .filter((d) => d.status === 'active').length;

  // Filter profiles based on selected status & search
  const filteredProfiles = allProfiles.filter((p) => {
    if (filter === 'valid' && !p.credentialOk) return false;
    if (filter === 'invalid' && p.credentialOk) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.moduleName.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Overview
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Revisión rápida de accesos a plataformas y estado general del sistema.
          </p>
        </div>
        <div>
          <button
            id="btn-dashboard-review-all"
            onClick={onReviewAll}
            disabled={isReviewing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReviewing ? 'animate-spin' : ''}`} />
            <span>{isReviewing ? 'Revisando accesos...' : 'Revisar todos'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Clientes activos</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-slate-900">{activeClientsCount}</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Cuentas con suscripción</p>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Accesos válidos</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-emerald-600">{validCount}</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Credenciales funcionando</p>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Accesos fallados</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-rose-600">{invalidCount}</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Requieren actualización</p>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Dispositivos activos</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Laptop className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-slate-900">{activeDevicesCount}</span>
            <p className="text-[11px] text-slate-400 mt-0.5">Equipos autorizados</p>
          </div>
        </div>
      </div>

      {/* Review Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Revisión de accesos</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Valida en tiempo real el estado de las credenciales asignadas a los perfiles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Todos ({allProfiles.length})
              </button>
              <button
                onClick={() => setFilter('valid')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  filter === 'valid' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Válidos ({validCount})
              </button>
              <button
                onClick={() => setFilter('invalid')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  filter === 'invalid' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Fallados ({invalidCount})
              </button>
            </div>
          </div>
        </div>

        {/* Table of profiles */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Módulo</th>
                <th className="py-3 px-4">Perfil</th>
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Última revisión</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No se encontraron perfiles con los filtros actuales.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap">
                      {p.credentialOk ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Válido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          No válido
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-700">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold text-[11px]">
                        {p.moduleName}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-7 rounded-md overflow-hidden bg-indigo-50 border border-slate-200 shrink-0 flex items-center justify-center">
                          {p.image ? (
                            <img
                              src={p.image}
                              alt={p.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-indigo-400 font-bold text-xs">◇</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <strong className="block text-slate-900 font-semibold text-xs truncate">
                            {p.name}
                          </strong>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 truncate max-w-[200px]"
                          >
                            <span>{p.url}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                      {p.username || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                      {formatDate(p.lastCheck)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {!p.credentialOk ? (
                        <button
                          id={`fix-btn-${p.id}`}
                          onClick={() => onFixCredential(p, p.moduleName)}
                          className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
                        >
                          Actualizar acceso
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs font-medium">Sin acción</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Note info box */}
      <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong className="block font-semibold">Demo local interactiva</strong>
          <span>
            La revisión verifica y actualiza el estado de las credenciales de forma simulada. Los cambios realizados se guardan automáticamente en el almacenamiento local de tu navegador.
          </span>
        </div>
      </div>
    </div>
  );
};
