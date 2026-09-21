export const SESSION_VALIDATION_WARN_MS = 12 * 60 * 60 * 1000;
export const SESSION_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ManagedSessionHealthStatus =
  | 'valid'
  | 'renew_soon'
  | 'pending_validation'
  | 'stale_validation'
  | 'needs_renewal'
  | 'not_configured';

export type ManagedSessionHealth = {
  usable: boolean;
  needsAttention: boolean;
  severity: 'ok' | 'warning' | 'critical';
  status: ManagedSessionHealthStatus;
  reason: string | null;
  validatedAt: string | null;
  ageMs: number | null;
};

function validationAge(validatedAt: unknown, nowMs: number): number | null {
  if (typeof validatedAt !== 'string' || !validatedAt.trim()) return null;
  const parsed = Date.parse(validatedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, nowMs - parsed);
}

export function managedSessionHealth(
  session: any,
  keeper: any = null,
  nowMs = Date.now(),
): ManagedSessionHealth {
  if (!session || session.status !== 'ready') {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'not_configured',
      reason: 'No hay una sesión central lista para este perfil.',
      validatedAt: null,
      ageMs: null,
    };
  }

  if (keeper?.enabled === true && keeper?.last_status === 'needs_admin') {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'needs_renewal',
      reason: keeper?.last_error || 'La web volvió a solicitar inicio de sesión.',
      validatedAt: session.last_validated_at || null,
      ageMs: validationAge(session.last_validated_at, nowMs),
    };
  }

  const ageMs = validationAge(session.last_validated_at, nowMs);
  if (ageMs === null) {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'pending_validation',
      reason: 'La sesión está guardada pero todavía no fue validada en la web.',
      validatedAt: null,
      ageMs: null,
    };
  }

  if (ageMs > SESSION_VALIDATION_MAX_AGE_MS) {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'stale_validation',
      reason: 'La última validación de la sesión tiene más de 24 horas.',
      validatedAt: session.last_validated_at,
      ageMs,
    };
  }

  const keeperNeedsSetup = !keeper
    || keeper.enabled !== true
    || !['healthy', 'refreshing'].includes(String(keeper.last_status || ''));

  if (ageMs > SESSION_VALIDATION_WARN_MS || keeperNeedsSetup) {
    let reason = 'Conviene volver a validar esta sesión antes de que llegue al límite de 24 horas.';
    if (!keeper) reason = 'Session Keeper todavía no está registrado para este perfil.';
    else if (keeper.enabled !== true || keeper.last_status === 'disabled') reason = 'Session Keeper está desactivado para este perfil.';
    else if (keeper.last_status === 'registered') reason = 'Session Keeper está registrado y espera su primera comprobación.';
    else if (keeper.last_status === 'error') reason = keeper.last_error || 'Session Keeper reportó un error y necesita revisión.';
    return {
      usable: true,
      needsAttention: true,
      severity: 'warning',
      status: 'renew_soon',
      reason,
      validatedAt: session.last_validated_at,
      ageMs,
    };
  }

  return {
    usable: true,
    needsAttention: false,
    severity: 'ok',
    status: 'valid',
    reason: null,
    validatedAt: session.last_validated_at,
    ageMs,
  };
}
