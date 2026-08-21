import React, { useState, useEffect } from 'react';
import { Search, Menu, RotateCcw, User, Server } from 'lucide-react';
import { ViewType } from '../types';
import { checkServerHealth, ServerHealthInfo } from '../services/api';

interface TopBarProps {
  currentView: ViewType;
  selectedClientName?: string | null;
  selectedModuleName?: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onResetDemo: () => void;
  onOpenMobileSidebar: () => void;
  onSelectSystemView?: () => void;
  isSyncingLive?: boolean;
  lastSyncTime?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentView,
  selectedClientName,
  selectedModuleName,
  searchQuery,
  onSearchChange,
  onResetDemo,
  onOpenMobileSidebar,
  onSelectSystemView,
  isSyncingLive,
  lastSyncTime,
}) => {
  const [health, setHealth] = useState<ServerHealthInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    checkServerHealth().then((info) => {
      if (mounted) setHealth(info);
    });
    const interval = setInterval(() => {
      checkServerHealth().then((info) => {
        if (mounted) setHealth(info);
      });
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const getViewTitle = () => {
    switch (currentView) {
      case 'dashboard':
        return 'Dashboard';
      case 'clients':
        return selectedClientName ? `Clientes / ${selectedClientName}` : 'Clientes';
      case 'modules':
        return selectedModuleName ? `Módulos / ${selectedModuleName}` : 'Módulos';
      case 'admins':
        return 'Administradores';
      case 'roles':
        return 'Roles y permisos';
      case 'security':
        return 'Seguridad';
      case 'system':
        return 'Sistema & Cloudflare';
    }
  };

  return (
    <header className="h-16 border-b border-slate-200 bg-white px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
      {/* Left: Mobile Menu & Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <span className="text-slate-400">CourseHub</span>
          <span className="text-slate-300">/</span>
          <strong className="text-slate-800 font-semibold">{getViewTitle()}</strong>
        </div>
      </div>

      {/* Right: Search & Actions */}
      <div className="flex items-center gap-3">
        {/* Live Auto-Sync Status Badge */}
        <div
          title={`Sincronización en tiempo real activa. Última sincronización: ${lastSyncTime || 'Ahora'}`}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
            isSyncingLive
              ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-2 ring-indigo-200'
              : 'bg-emerald-50/80 border-emerald-200 text-emerald-700'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isSyncingLive ? 'bg-indigo-600 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
          <span className="truncate">{isSyncingLive ? 'Sincronizando...' : 'Auto-Sync En Vivo'}</span>
        </div>

        {/* Live Server Indicator Badge */}
        <button
          onClick={onSelectSystemView}
          title="Ver estado de conexión con el servidor backend y Cloudflare"
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition-colors"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              health?.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <Server className="w-3.5 h-3.5 text-slate-500" />
          <span>{health?.status === 'online' ? 'Servidor Conectado' : 'Modo Offline'}</span>
          {health?.latencyMs !== undefined && health.status === 'online' && (
            <span className="text-[10px] text-slate-400 font-mono">({health.latencyMs}ms)</span>
          )}
        </button>

        {/* Search */}
        <div className="relative hidden md:flex items-center w-56 lg:w-64">
          <Search className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar perfiles, clientes..."
            className="w-full pl-9 pr-8 py-1.5 bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-transparent focus:border-indigo-400 rounded-lg text-xs text-slate-800 placeholder-slate-400 outline-none transition-all"
          />
        </div>

        {/* Reset Demo button */}
        <button
          id="btn-reset-demo"
          onClick={onResetDemo}
          title="Restablecer datos de demostración"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
          <span>Restablecer</span>
        </button>

        {/* Admin chip */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center font-bold text-xs">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden sm:block text-left leading-tight">
            <strong className="block text-xs font-bold text-slate-800">Admin</strong>
            <span className="block text-[10px] text-slate-400">Superadmin</span>
          </div>
        </div>
      </div>
    </header>
  );
};
