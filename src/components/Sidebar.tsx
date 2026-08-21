import React from 'react';
import {
  LayoutDashboard,
  Users,
  Layers,
  Shield,
  KeyRound,
  ShieldCheck,
  Cpu,
  MoreHorizontal,
  GraduationCap,
  Laptop,
  LogOut,
} from 'lucide-react';
import { ViewType } from '../types';

interface SidebarProps {
  currentView: ViewType;
  onSelectView: (view: ViewType) => void;
  clientCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  clientCount,
  mobileOpen,
  onCloseMobile,
  onLogout,
}) => {
  const navWorkspace = [
    { id: 'dashboard' as ViewType, label: 'Dashboard', icon: LayoutDashboard, count: null },
    { id: 'clients' as ViewType, label: 'Clientes', icon: Users, count: clientCount },
    { id: 'modules' as ViewType, label: 'Módulos & Cursos', icon: Layers, count: null },
    { id: 'desktop-app' as ViewType, label: 'Instalador PC & Cliente', icon: Laptop, count: null },
  ];

  const navAdmin = [
    { id: 'admins' as ViewType, label: 'Administradores', icon: Shield, count: null },
    { id: 'roles' as ViewType, label: 'Roles y permisos', icon: KeyRound, count: null },
    { id: 'security' as ViewType, label: 'Seguridad & Auditoría', icon: ShieldCheck, count: null },
    { id: 'system' as ViewType, label: 'Servidor & Sistema', icon: Cpu, count: null },
  ];

  const handleNav = (v: ViewType) => {
    onSelectView(v);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        id="sidebar"
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 w-64 bg-linear-to-b from-[#0e1420] to-[#141c2a] text-white flex flex-col p-4 border-r border-white/5 transition-transform duration-200 ease-in-out shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-2 py-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-indigo-500 to-indigo-700 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-indigo-600/30">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <strong className="block text-sm font-bold tracking-tight text-white">CourseHub</strong>
            <span className="block text-[11px] text-slate-400 font-medium">Admin Console V6</span>
          </div>
        </div>

        {/* Workspace pill */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
              CH
            </div>
            <div>
              <strong className="block text-xs font-semibold text-slate-200">CourseHub Cloud</strong>
              <span className="block text-[10px] text-slate-400">Workspace principal</span>
            </div>
          </div>
          <button className="text-slate-500 hover:text-slate-300 p-1">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation list */}
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <span className="px-2.5 pb-1 block text-[10px] font-bold text-slate-500 tracking-wider uppercase">
              Workspace
            </span>
            <div className="space-y-1">
              {navWorkspace.map((item) => {
                const Icon = item.icon;
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    id={`nav-${item.id}`}
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-linear-to-r from-indigo-600/30 to-indigo-600/10 text-white border-l-2 border-indigo-500 shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.count !== null && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-slate-300">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="px-2.5 pb-1 block text-[10px] font-bold text-slate-500 tracking-wider uppercase">
              Administración
            </span>
            <div className="space-y-1">
              {navAdmin.map((item) => {
                const Icon = item.icon;
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    id={`nav-${item.id}`}
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-linear-to-r from-indigo-600/30 to-indigo-600/10 text-white border-l-2 border-indigo-500 shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-white/[0.06] space-y-2">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] text-[11px] flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 font-medium text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
                <span>Admin Master</span>
              </div>
              <span className="block mt-0.5 text-[10px] text-slate-500">Sesión de Servidor</span>
            </div>

            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                title="Cerrar sesión de administrador"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

    </>
  );
};
