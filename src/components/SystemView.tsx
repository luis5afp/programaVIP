import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Server,
  Database,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Globe,
  Terminal,
  Copy,
  Check,
  Send,
  Cloud,
  Layers,
  ArrowUpRight,
  Code2,
  Download,
  Upload,
  Gauge,
  Zap,
} from 'lucide-react';
import { systemService } from '../services/systemService';
import { getApiBaseUrl, setCustomApiUrl } from '../services/apiClient';
import { ServerHealthInfo, CourseHubData } from '../types';

interface SystemViewProps {
  data?: CourseHubData;
  onDataChange?: (data: CourseHubData) => void;
  showToast?: (msg: string) => void;
}

export const SystemView: React.FC<SystemViewProps> = ({
  data: currentAppData,
  onDataChange,
  showToast,
}) => {
  const [health, setHealth] = useState<ServerHealthInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [customUrl, setCustomUrl] = useState(() => {
    return localStorage.getItem('coursehub-custom-api-url') || '';
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<any | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchHealth = async () => {
    setIsChecking(true);
    const info = await systemService.checkHealth();
    setHealth(info);
    setIsChecking(false);
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const handleSaveCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomApiUrl(customUrl);
    fetchHealth();
    if (showToast) showToast('URL del servidor actualizada');
  };

  const handleResetToDefaultUrl = () => {
    setCustomUrl('');
    setCustomApiUrl('');
    fetchHealth();
    if (showToast) showToast('Restablecido a la URL por defecto');
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const runTestEndpoint = async (endpoint: string, method: string = 'GET', body?: any) => {
    setTestingEndpoint(endpoint);
    setTestResponse('Cargando respuesta del servidor...');
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      setTestResponse(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setTestResponse(`Error al conectar con ${endpoint}: ${err.message}`);
    } finally {
      setTestingEndpoint(null);
    }
  };

  const handleRunBenchmark = async () => {
    setIsRunningBenchmark(true);
    try {
      const res = await systemService.runBenchmark();
      if (res.success && res.data) {
        setBenchmarkResult(res.data);
      }
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  // Export full JSON database
  const handleExportJson = () => {
    const dataToExport = currentAppData || {};
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coursehub-database-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (showToast) showToast('Copia de seguridad descargada');
  };

  // Import full JSON database
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && Array.isArray(parsed.modules) && Array.isArray(parsed.clients)) {
          const res = await systemService.importJson(parsed);
          if (res.success && onDataChange) {
            onDataChange(parsed);
            if (showToast) showToast('Base de datos restaurada con éxito');
          }
        } else {
          alert('El archivo JSON no tiene la estructura esperada de CourseHub.');
        }
      } catch (err: any) {
        alert('Error al leer el archivo JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const wranglerConfigCode = `# wrangler.toml - Configuración para Cloudflare Pages / Workers
name = "coursehub-admin"
compatibility_date = "2024-09-23"
pages_build_output_dir = "dist"

# Despliegue de Pages Functions + Frontend:
# 1. npm run build
# 2. npx wrangler pages deploy dist --project-name=coursehub-admin`;

  const d1SqlCode = `-- Base de Datos D1 en Cloudflare (SQLite distribuido)
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◇',
  desc TEXT,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  credential_ok INTEGER DEFAULT 1,
  last_check TEXT,
  image TEXT,
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'active',
  plan TEXT,
  start_date TEXT,
  end_date TEXT,
  renewal TEXT DEFAULT 'manual',
  modules_json TEXT,
  profile_ids_json TEXT
);`;

  return (
    <div className="space-y-6">
      {/* Hidden File Input for JSON Restore */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json,application/json"
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold tracking-widest text-indigo-600 uppercase">
            System & Cloudflare Engine
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Servidor, API & Despliegue Cloudflare
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Gestión de la comunicación bidireccional entre la interfaz y el backend Express / Cloudflare Pages Functions.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          <button
            onClick={fetchHealth}
            disabled={isChecking}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Comprobando...' : 'Comprobar Servidor'}</span>
          </button>
        </div>
      </div>

      {/* Live Server Status Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                health?.status === 'online'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-amber-50 text-amber-600'
              }`}
            >
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900">Servidor Backend Adjunto</h3>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    health?.status === 'online'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      health?.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {health?.status === 'online' ? 'Conectado / Activo' : 'Offline / Almacenamiento Local'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Endpoint base actual: <code className="font-mono text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-[11px]">{getApiBaseUrl()}</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Latencia</span>
              <strong className="text-slate-800 font-mono">
                {health?.latencyMs !== undefined ? `${health.latencyMs} ms` : '—'}
              </strong>
            </div>
            <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Entorno</span>
              <strong className="text-slate-800">{health?.edgeRuntime || 'Node.js / Cloudflare'}</strong>
            </div>
            <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Versión API</span>
              <strong className="text-slate-800">{health?.version || '6.0.0'}</strong>
            </div>
          </div>
        </div>

        {/* Custom Backend URL Configuration */}
        <div className="pt-4">
          <form onSubmit={handleSaveCustomUrl} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Conectar a un Cloudflare Worker externo (opcional si está en otro subdominio)
              </label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://coursehub-api.tu-subdominio.workers.dev/api"
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>
            <div className="flex items-end gap-2 pt-1 sm:pt-4">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                Guardar URL
              </button>
              {customUrl && (
                <button
                  type="button"
                  onClick={handleResetToDefaultUrl}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-colors"
                >
                  Restablecer
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Database Backup & Restore & Benchmark Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Backup / Restore */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Copia de Seguridad & Restauración JSON</h3>
          </div>
          <p className="text-xs text-slate-500">
            Exporta el estado completo de clientes, módulos, perfiles y roles a un archivo JSON, o importa un archivo previamente respaldado.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Copia JSON</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar Archivo JSON</span>
            </button>
          </div>
        </div>

        {/* Benchmark */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-sm text-slate-900">Prueba de Rendimiento & Latencia</h3>
            </div>
            <button
              onClick={handleRunBenchmark}
              disabled={isRunningBenchmark}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-colors"
            >
              <Zap className={`w-3.5 h-3.5 ${isRunningBenchmark ? 'animate-bounce' : ''}`} />
              <span>{isRunningBenchmark ? 'Ejecutando...' : 'Iniciar Benchmark'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Ejecuta 50,000 operaciones matemáticas y mide el tiempo de respuesta del motor V8 en el servidor.
          </p>
          {benchmarkResult && (
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Cómputo en Servidor</span>
                <span className="font-bold text-slate-800">{benchmarkResult.latencyMs} ms (50k iteraciones)</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Óptimo
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Cloudflare Architecture Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center mb-3">
              <Cloud className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">Cloudflare Pages + Functions</h3>
            <p className="text-xs text-slate-500 mt-1">
              Despliegue unificado: el frontend React y las funciones de API <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded text-[10px]">/functions/api</code> se suben juntos a Cloudflare Pages sin configurar servidores adicionales.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 inline-block">
              ✓ Listo en el proyecto
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">Servidor Node / Express</h3>
            <p className="text-xs text-slate-500 mt-1">
              Servidor backend completo en <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded text-[10px]">server.ts</code> con todos los endpoints REST, middleware Vite para desarrollo y ejecución en contenedores o VPS.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 inline-block">
              ✓ Ejecutando en puerto 3000
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">Cloudflare D1 / KV Database</h3>
            <p className="text-xs text-slate-500 mt-1">
              Esquema SQL preparado para Cloudflare D1 (SQLite distribuido en el edge) y persistencia JSON en KV para sincronización ultra rápida.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 inline-block">
              ✓ Esquema SQL Generado
            </span>
          </div>
        </div>
      </div>

      {/* Interactive REST API Endpoint Tester */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-900">Probador de Endpoints REST del Servidor</h3>
          </div>
          <span className="text-[11px] text-slate-400">Verifica la respuesta en vivo del servidor adjunto</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runTestEndpoint('/health')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/health
          </button>
          <button
            onClick={() => runTestEndpoint('/data')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/data
          </button>
          <button
            onClick={() => runTestEndpoint('/clients')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/clients
          </button>
          <button
            onClick={() => runTestEndpoint('/modules')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/modules
          </button>
          <button
            onClick={() => runTestEndpoint('/security/stats')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/security/stats
          </button>
          <button
            onClick={() => runTestEndpoint('/security/audit-logs')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/security/audit-logs
          </button>
          <button
            onClick={() => runTestEndpoint('/verify-access', 'POST')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            POST /api/verify-access
          </button>
          <button
            onClick={() => runTestEndpoint('/system/benchmark')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/system/benchmark
          </button>
          <button
            onClick={() => runTestEndpoint('/system/schema-sql')}
            disabled={testingEndpoint !== null}
            className="px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-700 rounded-lg text-xs font-mono font-medium transition-colors"
          >
            GET /api/system/schema-sql
          </button>
        </div>

        {testResponse && (
          <div className="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs max-h-56 overflow-auto border border-slate-800">
            <div className="flex items-center justify-between mb-2 text-slate-400 border-b border-slate-800 pb-1">
              <span className="text-[10px] uppercase font-bold tracking-wider">Respuesta del Servidor</span>
              <button
                onClick={() => copyToClipboard(testResponse, 'test-res')}
                className="hover:text-white flex items-center gap-1 text-[10px]"
              >
                {copiedKey === 'test-res' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedKey === 'test-res' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="whitespace-pre-wrap">{testResponse}</pre>
          </div>
        )}
      </div>

      {/* Cloudflare Deployment Code & Guides */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* wrangler.toml */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-orange-500" />
              <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                Configuración wrangler.toml
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(wranglerConfigCode, 'wrangler')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
            >
              {copiedKey === 'wrangler' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'wrangler' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-[11px] overflow-x-auto">
            {wranglerConfigCode}
          </pre>
          <p className="text-[11px] text-slate-500">
            Ubicado en la raíz del proyecto para despliegue directo con el CLI de Wrangler.
          </p>
        </div>

        {/* D1 SQL Schema */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                Esquema Cloudflare D1 SQL
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(d1SqlCode, 'd1')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
            >
              {copiedKey === 'd1' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'd1' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48">
            {d1SqlCode}
          </pre>
          <p className="text-[11px] text-slate-500">
            Ejecuta <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded text-[10px]">npx wrangler d1 execute coursehub-db --file=./cloudflare/schema.sql</code> en tu terminal.
          </p>
        </div>
      </div>
    </div>
  );
};
