import React from 'react';
import { KeyRound, Plus, Shield } from 'lucide-react';
import { CourseHubData } from '../types';

interface RolesViewProps {
  data: CourseHubData;
  onNewRole: () => void;
}

export const RolesView: React.FC<RolesViewProps> = ({ data, onNewRole }) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Access Control
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Roles y Permisos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configuración de roles y capacidades para operadores y administradores.
          </p>
        </div>
        <div>
          <button
            onClick={onNewRole}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo rol</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4 w-48">Rol</th>
                <th className="py-3 px-4">Permisos asignados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.roles.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-4 px-4 align-top">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-indigo-600" />
                      <strong className="text-slate-900 font-bold text-xs">{r.name}</strong>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {r.permissions.map((p, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50/80 text-indigo-700 border border-indigo-100"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
