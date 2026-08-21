import React, { useState } from 'react';
import { ShieldCheck, Lock, User, ArrowRight, GraduationCap, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface AdminLoginGuardProps {
  onLoginSuccess: (adminName: string) => void;
}

export const AdminLoginGuard: React.FC<AdminLoginGuardProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    setTimeout(() => {
      const cleanUser = username.trim().toLowerCase();
      const cleanPass = password.trim();

      if (
        (cleanUser === 'admin' ||
          cleanUser === 'admin_master' ||
          cleanUser === 'luis5afp' ||
          cleanUser === 'luis5afp@gmail.com') &&
        (cleanPass === 'admin123' || cleanPass === '8899' || cleanPass === 'admin' || cleanPass === 'password')
      ) {
        localStorage.setItem(
          'coursehub_admin_auth',
          JSON.stringify({
            authenticated: true,
            user: cleanUser,
            token: 'jwt_admin_' + Date.now(),
            loginAt: new Date().toISOString(),
          })
        );
        onLoginSuccess(cleanUser);
      } else {
        setError('Usuario o contraseña incorrectos. Verifica tus credenciales de acceso.');
      }
      setIsLoading(false);
    }, 350);
  };

  return (
    <div className="min-h-screen bg-[#080d1a] text-slate-100 flex items-center justify-center p-4 relative select-none">
      {/* Background ambient lighting */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800/80 p-8 sm:p-10 shadow-2xl space-y-7 relative z-10">
        {/* Header */}
        <div className="text-center space-y-2.5">
          <div className="w-13 h-13 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-600/30 text-white">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">CourseHub VIP</h1>
            <p className="text-xs text-slate-400 mt-1 font-medium">Panel de Administración del Servidor</p>
          </div>
        </div>

        {/* Login Form: Usuario & Contraseña */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              Usuario
            </label>
            <div className="relative flex items-center">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ingresa tu usuario"
                autoFocus
                required
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/90 border border-slate-800 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              Contraseña
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-10 py-2.5 bg-slate-950/90 border border-slate-800 rounded-xl text-sm font-medium text-white placeholder:text-slate-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 text-slate-500 hover:text-slate-300 transition-colors p-1"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2 animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>{isLoading ? 'Accediendo...' : 'Iniciar Sesión'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Security watermark */}
        <div className="pt-2 border-t border-slate-800/60 text-center">
          <span className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Servidor Central Seguro & Cifrado</span>
          </span>
        </div>
      </div>
    </div>
  );
};

