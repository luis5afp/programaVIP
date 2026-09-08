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
  Trash2,
  CheckSquare,
  Square,
  UserCheck,
  ShieldAlert,
  ShieldX,
  Copy,
  Eye,
  EyeOff,
  Send,
} from 'lucide-react';
import { Client, ClientTabType, CourseHubData } from '../types';
import { getSubscriptionState, formatDate } from '../utils/helpers';

interface ClientsViewProps {
  data: CourseHubData;
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  onNewClient: () => void;
  onEditClientInfo?: (client: Client) => void;
  onDeleteClient?: (clientId: string) => void;
  onEditSubscription: (client: Client) => void;
  onToggleModule: (clientId: string, moduleId: string, checked: boolean) => void;
  onToggleProfile: (clientId: string, profileId: string, checked: boolean) => void;
  onToggleDeviceStatus?: (clientId: string, deviceId: string) => void;
  onBulkAssignModules?: (clientId: string, enableAll: boolean) => void;
  onBulkAssignProfiles?: (clientId: string, enableAll: boolean) => void;
  searchQuery: string;
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  data,
  selectedClientId,
  onSelectClient,
  onNewClient,
  onEditClientInfo,
  onDeleteClient,
  onEditSubscription,
  onToggleModule,
  onToggleProfile,
  onToggleDeviceStatus,
  onBulkAssignModules,
  onBulkAssignProfiles,
  searchQuery,
}) => {
  const [activeTab, setActiveTab] = useState<ClientTabType>('info');
  const [showSelectedPassword, setShowSelectedPassword] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedFeedback(label);
      setTimeout(() => setCopiedFeedback(null), 2500);
    } catch {
      // fallback
    }
  };

  const selectedClient = data.clients.find((c) => c.id === selectedClientId);

  // Filter clients by search
  const filteredClients = data.clients.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.username && c.username.toLowerCase().includes(q)) ||
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

              {onEditClientInfo && (
                <button
                  id="btn-edit-client-info"
                  onClick={() => onEditClientInfo(selectedClient)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 shadow-xs transition-colors"
                >
                  <Edit className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Editar datos</span>
                </button>
              )}

              {onDeleteClient && (
                <button
                  id="btn-delete-client"
                  onClick={() => {
                    if (window.confirm(`¿Estás seguro de que deseas eliminar al cliente "${selectedClient.name}"? Esta acción removerá sus accesos y suscripciones.`)) {
                      onDeleteClient(selectedClient.id);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-bold text-rose-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Eliminar</span>
                </button>
              )}
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
          <div className="space-y-6">
            {/* CARD: Credenciales de Acceso al Software en la PC */}
            <div className="bg-gradient-to-br from-indigo-50/90 via-white to-indigo-50/40 p-5 rounded-2xl border border-indigo-200/80 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
                    <Laptop className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-indigo-950">
                        Credenciales de Acceso al Software en PC
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                        Login Desktop
                      </span>
                    </div>
                    <p className="text-xs text-indigo-700/90 mt-0.5">
                      Datos que el cliente debe ingresar en la aplicación instalada en su computadora para acceder a sus perfiles.
                    </p>
                  </div>
                </div>

                {onEditClientInfo && (
                  <button
                    onClick={() => onEditClientInfo(selectedClient)}
                    className="self-start sm:self-auto px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Cambiar credenciales</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Usuario PC */}
                <div className="p-3.5 bg-white rounded-xl border border-indigo-100/90 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Key className="w-3 h-3 text-indigo-600" />
                      <span>Usuario para la PC</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(selectedClient.username || selectedClient.email.split('@')[0], 'usuario')}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                      title="Copiar usuario"
                    >
                      {copiedFeedback === 'usuario' ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Copiado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Copy className="w-3 h-3" /> Copiar
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="text-sm font-mono font-bold text-slate-900 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 break-all">
                    {selectedClient.username || selectedClient.email.split('@')[0]}
                  </div>
                </div>

                {/* Contraseña PC */}
                <div className="p-3.5 bg-white rounded-xl border border-indigo-100/90 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Key className="w-3 h-3 text-indigo-600" />
                      <span>Contraseña de acceso</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowSelectedPassword(!showSelectedPassword)}
                        className="text-[11px] text-slate-500 hover:text-slate-800"
                        title={showSelectedPassword ? 'Ocultar' : 'Ver'}
                      >
                        {showSelectedPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(selectedClient.password || 'cliente123', 'password')}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                        title="Copiar contraseña"
                      >
                        {copiedFeedback === 'password' ? (
                          <span className="text-emerald-600 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Copiado
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Copy className="w-3 h-3" /> Copiar
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="text-sm font-mono font-bold text-slate-900 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center justify-between">
                    <span>
                      {showSelectedPassword ? (selectedClient.password || 'cliente123') : '••••••••••••'}
                    </span>
                  </div>
                </div>

                {/* Enviar al cliente por WhatsApp / Email */}
                <div className="p-3.5 bg-white rounded-xl border border-indigo-100/90 shadow-2xs flex flex-col justify-between space-y-2">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      Entrega al cliente
                    </span>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Copia el mensaje completo con usuario y clave para enviarlo por WhatsApp o correo.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const msg = `¡Hola ${selectedClient.name}! Aquí tienes tus credenciales de acceso a tu aplicación en la PC:\n\n💻 Usuario: ${selectedClient.username || selectedClient.email.split('@')[0]}\n🔑 Contraseña: ${selectedClient.password || 'cliente123'}\n📅 Plan: ${selectedClient.subscription.plan}\n\nIngresa estos datos en la pantalla de inicio de sesión del programa en tu computadora.`;
                      copyToClipboard(msg, 'mensaje');
                    }}
                    className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                  >
                    {copiedFeedback === 'mensaje' ? (
                      <span className="text-emerald-600 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> ¡Mensaje copiado!
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" /> Copiar mensaje completo
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Módulos Habilitados</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Selecciona qué secciones de catálogo estarán disponibles para este cliente.
                </p>
              </div>
              {onBulkAssignModules && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onBulkAssignModules(selectedClient.id, true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Habilitar todos</span>
                  </button>
                  <button
                    onClick={() => onBulkAssignModules(selectedClient.id, false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Desmarcar todos</span>
                  </button>
                </div>
              )}
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
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Perfiles Asignados</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Marca las credenciales de acceso específicas que este cliente puede utilizar.
                </p>
              </div>
              {onBulkAssignProfiles && availableProfiles.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onBulkAssignProfiles(selectedClient.id, true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Asignar todos</span>
                  </button>
                  <button
                    onClick={() => onBulkAssignProfiles(selectedClient.id, false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Desasignar todos</span>
                  </button>
                </div>
              )}
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
                      {onToggleDeviceStatus && <th className="py-3 px-4 text-right">Acción</th>}
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
                        {onToggleDeviceStatus && (
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => onToggleDeviceStatus(selectedClient.id, d.id)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                d.status === 'active'
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              {d.status === 'active' ? 'Revocar acceso' : 'Autorizar equipo'}
                            </button>
                          </td>
                        )}
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
                          <span className="text-[11px] text-slate-400 block">{c.email}</span>
                          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-indigo-50/80 text-indigo-700 text-[10px] font-mono border border-indigo-100">
                            <Laptop className="w-2.5 h-2.5 text-indigo-600" />
                            <span>PC: {c.username || c.email.split('@')[0]}</span>
                          </span>
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
