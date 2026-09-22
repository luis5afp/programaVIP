import { FormEvent, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../api';
import type { AdminSession } from '../types';
import { ErrorBanner, Field } from './ui';

export function Login({ onSuccess }: { onSuccess: (session: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await api.login(username.trim(), password);
      onSuccess(result.user);
    } catch (err) {
      const apiError = err as ApiError;
      const diagnostic = apiError.requestId ? ` · ID: ${apiError.requestId}` : '';
      if (apiError.status === 401 || apiError.code === 'INVALID_CREDENTIALS') {
        setError('Usuario o contraseña incorrectos.');
      } else if (apiError.status === 429) {
        setError('Demasiados intentos. Intenta nuevamente más tarde.');
      } else if (apiError.code === 'ORIGIN_REJECTED') {
        setError(`El navegador bloqueó la validación de origen. Recarga la página e intenta nuevamente.${diagnostic}`);
      } else if (apiError.status === 0 || apiError.status >= 500) {
        setError(`No se pudo validar el acceso con el servidor. Intenta nuevamente.${diagnostic}`);
      } else {
        setError(`${apiError.message || 'No se pudo iniciar sesión.'}${diagnostic}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-screen"><form className="login-card" onSubmit={submit}><div className="login-logo">uF</div><h1>userFLEX Admin</h1><p>Panel privado de administración</p><ErrorBanner message={error} /><div className="grid" style={{ gap: 14 }}><Field label="Usuario"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></Field><Field label="Contraseña"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field><button className="button primary" disabled={busy} type="submit"><LockKeyhole size={15} /> {busy ? 'Validando…' : 'Iniciar sesión'}</button></div><div className="login-security"><ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 5 }} />La contraseña se valida en el servidor. No se guarda en el navegador.</div></form></main>;
}
