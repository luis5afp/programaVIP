import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, Key, Server, RefreshCw, AlertTriangle, CheckCircle2, UserX, Activity, ShieldAlert } from 'lucide-react';
import { securityService } from '../services/securityService';
import { AuditLogEntry, SecurityStats } from '../types';

export const SecurityView: React.FC = () => {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadSecurityData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, logsRes] = await Promise.all([
        securityService.getStats(),
        securityService.getAuditLogs({ category: selectedCategory }),
      ]);
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }
      if (logsRes.success && logsRes.data) {
        setLogs(logsRes.data);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSecurityData();
  }, [selectedCategory]);

  const handleRevokeSession = async (targetId: string, type: 'admin' | 'client') => {
    setRevokingId(targetId);
    const res = await securityService.revokeSession(targetId, type);
    if (res.success) {
      setFeedback(`Sesión revocada exitosamente para ${type}`);
      setTimeout(() => setFeedback(null), 3000);
      loadSecurityData();
    }
    setRevokingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            Security & Audit Engine
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Seguridad, Cifrado & Auditoría
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Políticas de protección del servidor, cifrado AES-256, estado de credenciales y registros de auditoría en tiempo real.
          </p>
        </div>

        <button
          onClick={loadSecurityData}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-xs transition-colors self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Actualizando...' : 'Recargar Auditoría'}</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Security Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Clientes Activos</span>
          <div className="text-xl font-black text-slate-900 mt-1">
            {stats ? `${stats.activeClients} / ${stats.totalClients}` : '—'}
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">100% Cuentas verificadas</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Credenciales Válidas</span>
          <div className="text-xl font-black text-slate-900 mt-1">
            {stats ? stats.validCredentials : '—'}
          </div>
          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
            {stats ? `${stats.invalidCredentials} requieren revisión` : '—'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Dispositivos Vinculados</span>
          <div className="text-xl font-black text-slate-900 mt-1">
            {stats ? stats.totalDevices : '—'}
          </div>
          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
            {stats ? `${stats.revokedDevices} revocados por seguridad` : '—'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Administradores Activos</span>
          <div className="text-xl font-black text-slate-900 mt-1">
            {stats ? stats.activeAdmins : '—'}
          </div>
          <span className="text-[10px] text-indigo-600 font-semibold mt-0.5 block">MFA & RBAC Enforzado</span>
        </div>
      </div>

      {/* Security Policies Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Acceso Administrativo & API</h3>
              <p className="text-xs text-slate-500">Políticas del servidor y control de acceso</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Autenticación API REST</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Bearer Token + HMAC
              </span>
            </div>
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Headers de seguridad CORS</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Strict Origin / Cloudflare Proxy
              </span>
            </div>
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Control por roles (RBAC)</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Activo
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Credenciales Externas & Cifrado</h3>
              <p className="text-xs text-slate-500">Cifrado de perfiles y sincronización</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Verificador automático</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Válido / No válido
              </span>
            </div>
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Almacenamiento de contraseñas</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                AES-GCM-256 en Servidor / D1
              </span>
            </div>
            <div className="py-3 flex items-center justify-between">
              <span className="text-slate-600">Entrega segura a clientes</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Cifrado TLS 1.3
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Logs Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Registro de Auditoría en Vivo (Audit Logs)</h3>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            {(['all', 'auth', 'client', 'module', 'system', 'security'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] capitalize transition-all ${
                  selectedCategory === cat
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {cat === 'all' ? 'Todos' : cat}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                <th className="pb-3 pl-2">Fecha y Hora</th>
                <th className="pb-3">Usuario / Origen</th>
                <th className="pb-3">Categoría</th>
                <th className="pb-3">Acción Registrada</th>
                <th className="pb-3 pr-2">Detalles / IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No hay registros de auditoría en esta categoría.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 pl-2 text-slate-500 font-mono text-[11px]">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 font-semibold text-slate-800">
                      {log.user}
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        log.category === 'security'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : log.category === 'client'
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : log.category === 'module'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="py-3 text-slate-900 font-medium">{log.action}</td>
                    <td className="py-3 pr-2 text-slate-500 font-mono text-[11px]">
                      {log.details || log.ip || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
