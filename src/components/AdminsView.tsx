import React from 'react';
import { Shield, UserPlus, CheckCircle2, Trash2 } from 'lucide-react';
import { CourseHubData } from '../types';
import { formatDate } from '../utils/helpers';

interface AdminsViewProps {
  data: CourseHubData;
  onNewAdmin: () => void;
  onDeleteAdmin?: (adminId: string) => void;
}

export const AdminsView: React.FC<AdminsViewProps> = ({ data, onNewAdmin, onDeleteAdmin }) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Administration
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Administradores del Sistema
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Gestión de usuarios internos con privilegios de acceso y control del panel.
          </p>
        </div>
        <div>
          <button
            onClick={onNewAdmin}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Nuevo administrador</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Administrador</th>
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Rol asignado</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Último acceso</th>
                {onDeleteAdmin && <th className="py-3 px-4 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.admins.map((a) => {
                const isMaster = a.username === 'admin_master' || a.id === 'a1';
                return (
                  <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs border border-indigo-100">
                          {a.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <strong className="block text-slate-900 font-bold text-xs">{a.name}</strong>
                          <span className="text-[11px] text-slate-400">{a.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">{a.username}</td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {a.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Activo</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">{formatDate(a.last)}</td>
                    {onDeleteAdmin && (
                      <td className="py-3 px-4 text-right">
                        {!isMaster && data.admins.length > 1 ? (
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Eliminar al administrador "${a.name}"?`)) {
                                onDeleteAdmin(a.id);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Eliminar administrador"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Principal</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
