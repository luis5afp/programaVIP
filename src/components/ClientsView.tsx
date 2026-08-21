import React, { useState } from 'react';
import {
  UserPlus,
  ArrowLeft,
  Calendar,
  Layers,
  Key,
  Laptop,
  History,
  Info,
  Edit,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { Client, ClientTabType, CourseHubData } from '../types';
import { getSubscriptionState, formatDate } from '../utils/helpers';

interface ClientsViewProps {
  data: CourseHubData;
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  onNewClient: () => void;
  onEditSubscription: (client: Client) => void;
  onToggleModule: (clientId: string, moduleId: string, checked: boolean) => void;
  onToggleProfile: (clientId: string, profileId: string, checked: boolean) => void;
  searchQuery: string;
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  data,
  selectedClientId,
  onSelectClient,
  onNewClient,
  onEditSubscription,
  onToggleModule,
  onToggleProfile,
  searchQuery,
}) => {
  const [activeTab, setActiveTab] = useState<ClientTabType>('info');

  const selectedClient = data.clients.find((c) => c.id === selectedClientId);

  // Filter clients by search
  const filteredClients = data.clients.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.subscription.plan.toLowerCase().includes(q)
    );
  });

  // If a client is selected, show the Client Detail view
  if (selectedClient) {
    const subState = getSubscriptionState(selectedClient);
    const tabs: { id: ClientTabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
      { id: 'info', label: 'Información', icon: Info },
      { id: 'subscription', label: 'Suscripción', icon: Calendar },
      { id: 'modules', label: 'Módulos', icon: Layers },
      { id: 'profiles', label: 'Perfiles', icon: Key },
      { id: 'devices', label: 'Dispositivos', icon: Laptop },
      { id: 'history', label: 'Historial', icon: History },
    ];

    // Enabled modules for this client
    const activeModuleCount = Object.values(selectedClient.modules).filter(Boolean).length;

    // Profiles from enabled modules
    const availableProfiles = data.modules
      .filter((m) => selectedClient.modules[m.id])
      .flatMap((m) => m.profiles.map((p) => ({ ...p, moduleName: m.name })));

    return (
      <div className="space-y-6">
        {/* Top Hero */}
        <div className="p-6 rounded-2xl bg-linear-to-r from-white via-slate-50 to-indigo-50/40 border border-slate-200 shadow-xs">
          <button
            onClick={() => onSelectClient(null)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver a la lista de clientes</span>
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center font-black text-xl shadow-md shadow-indigo-600/20">
                {selectedClient.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                  {selectedClient.name}
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">
                  {selectedClient.email} · {selectedClient.phone || 'Sin teléfono'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Cliente activo
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border ${
                  subState.cls === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : subState.cls === 'warn'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {subState.label}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Contents */}
        {activeTab === 'info' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="font-bold text-sm text-slate-900">Información de contacto</h3>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Nombre completo</span>
                  <strong className="text-slate-900">{selectedClient.name}</strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Correo electrónico</span>
                  <strong className="text-slate-900">{selectedClient.email}</strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Teléfono</span>
                  <strong className="text-slate-900">{selectedClient.phone || '—'}</strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Estado de cuenta</span>
                  <span className="text-emerald-700 font-bold">Activo</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="font-bold text-sm text-slate-900">Resumen de acceso</h3>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Plan actual</span>
                  <strong className="text-indigo-600 font-bold">
                    {selectedClient.subscription.plan}
                  </strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Estado suscripción</span>
                  <strong className={subState.cls === 'ok' ? 'text-emerald-600' : 'text-amber-600'}>
                    {subState.label}
                  </strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Módulos contratados</span>
                  <strong className="text-slate-900">{activeModuleCount} activos</strong>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Perfiles asignados</span>
                  <strong className="text-slate-900">{selectedClient.profileIds.length} perfiles</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subscription' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Detalles de la Suscripción</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Vigencia, tipo de renovación y estado del servicio.
                </p>
              </div>
              <button
                id="btn-edit-subscription"
                onClick={() => onEditSubscription(selectedClient)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>Editar suscripción</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3 text-xs bg-slate-50/70 p-4 rounded-xl border border-slate-100">
                <div className="flex justify-between py-1.5 border-b border-slate-200/60">
                  <span className="text-slate-500">Plan contratado</span>
                  <strong className="text-slate-900 font-bold">
                    {selectedClient.subscription.plan}
                  </strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/60">
                  <span className="text-slate-500">Fecha de inicio</span>
                  <strong className="text-slate-900">{selectedClient.subscription.start}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/60">
                  <span className="text-slate-500">Fecha de vencimiento</span>
                  <strong className="text-slate-900">{selectedClient.subscription.end}</strong>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-500">Tipo de renovación</span>
                  <strong className="text-slate-900 uppercase text-[10px]">
                    {selectedClient.subscription.renewal}
                  </strong>
                </div>
              </div>

              <div className="space-y-3 text-xs bg-slate-50/70 p-4 rounded-xl border border-slate-100">
                <div className="flex justify-between py-1.5 border-b border-slate-200/60">
                  <span className="text-slate-500">Estado</span>
                  <span
                    className={`font-bold ${
                      subState.cls === 'ok'
                        ? 'text-emerald-600'
                        : subState.cls === 'warn'
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {subState.label}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200/60">
                  <span className="text-slate-500">Días restantes</span>
                  <strong className="text-slate-900 font-mono text-sm">
                    {Math.max(0, subState.days)} días
                  </strong>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-500">Acceso a plataformas</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      subState.cls === 'bad'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {subState.cls === 'bad' ? 'Bloqueado por vencimiento' : 'Permitido'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'modules' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Módulos Habilitados</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Selecciona qué secciones de catálogo estarán disponibles para este cliente.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              {data.modules.map((m) => {
                const isEnabled = !!selectedClient.modules[m.id];
                return (
                  <div
                    key={m.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isEnabled
                        ? 'bg-indigo-50/40 border-indigo-200'
                        : 'bg-slate-50 border-slate-200 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 font-bold text-sm shadow-xs">
                        {m.icon}
                      </div>
                      <input
                        type="checkbox"
                        id={`module-toggle-${m.id}`}
                        checked={isEnabled}
                        onChange={(e) => onToggleModule(selectedClient.id, m.id, e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <h4 className="font-bold text-xs text-slate-900">{m.name}</h4>
                    <p className="text-[11px] text-slate-500 mt-1 min-h-[30px] line-clamp-2">
                      {m.desc}
                    </p>
                    <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{m.profiles.length} perfiles</span>
                      <span className={isEnabled ? 'text-indigo-600 font-bold' : 'text-slate-400'}>
                        {isEnabled ? 'Activo' : 'Desactivado'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'profiles' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Perfiles Asignados</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Marca las credenciales de acceso específicas que este cliente puede utilizar.
              </p>
            </div>

            {availableProfiles.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No hay perfiles disponibles porque no hay módulos activos para este cliente. Habilita
                módulos en la pestaña anterior.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      <th className="py-3 px-4">Módulo</th>
                      <th className="py-3 px-4">Perfil</th>
                      <th className="py-3 px-4">Estado Global</th>
                      <th className="py-3 px-4 text-center">Asignado al Cliente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {availableProfiles.map((p) => {
                      const isAssigned = selectedClient.profileIds.includes(p.id);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-700">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px]">
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
                              <div>
                                <strong className="block text-slate-900 font-semibold text-xs">
                                  {p.name}
                                </strong>
                                <span className="text-[10px] text-slate-400 block truncate max-w-[200px]">
                                  {p.url}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {p.credentialOk ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Válido
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                No válido
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={(e) =>
                                onToggleProfile(selectedClient.id, p.id, e.target.checked)
                              }
                              className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'devices' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Dispositivos Autorizados</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Equipos vinculados desde la aplicación de escritorio o portal de acceso.
              </p>
            </div>

            {selectedClient.devices.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No hay dispositivos registrados para este cliente.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      <th className="py-3 px-4">Equipo</th>
                      <th className="py-3 px-4">Sistema Operativo</th>
                      <th className="py-3 px-4">Estado</th>
                      <th className="py-3 px-4">Último contacto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedClient.devices.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900">{d.name}</td>
                        <td className="py-3 px-4 text-slate-600">{d.os}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              d.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {d.status === 'active' ? 'Activo' : 'Revocado'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(d.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Historial Administrativo</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Registro de acciones, modificaciones de suscripción y accesos.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-3 px-4">Fecha y Hora</th>
                    <th className="py-3 px-4">Acción realizada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedClient.history.map((h, i) => (
                    <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {formatDate(h.at)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">{h.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Otherwise, render the Directory of Clients
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Customer Management
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Directorio de Clientes
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Administra suscripciones, asignación de módulos, perfiles y dispositivos autorizados.
          </p>
        </div>
        <div>
          <button
            id="btn-new-client"
            onClick={onNewClient}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Nuevo cliente</span>
          </button>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4">Plan</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Vencimiento</th>
                <th className="py-3 px-4 text-center">Módulos</th>
                <th className="py-3 px-4 text-center">Perfiles</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No se encontraron clientes registrados.
                  </td>
                </tr>
              ) : (
                filteredClients.map((c) => {
                  const subState = getSubscriptionState(c);
                  const activeMods = Object.values(c.modules).filter(Boolean).length;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div>
                          <strong className="block font-bold text-slate-900 text-xs">
                            {c.name}
                          </strong>
                          <span className="text-[11px] text-slate-400">{c.email}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700">
                        {c.subscription.plan}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            subState.cls === 'ok'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : subState.cls === 'warn'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {subState.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {c.subscription.end}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                          {activeMods}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                          {c.profileIds.length}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          id={`open-client-${c.id}`}
                          onClick={() => onSelectClient(c.id)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-lg text-xs font-bold transition-colors"
                        >
                          Abrir ficha
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
