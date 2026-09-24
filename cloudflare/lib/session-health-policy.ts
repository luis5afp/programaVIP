export const SESSION_VALIDATION_WARN_MS = 12 * 60 * 60 * 1000;
export const SESSION_VALIDATION_STALE_MS = 24 * 60 * 60 * 1000;

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

export function latestValidationTimestamp(...values: unknown[]): string | null {
  let latestValue: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > latestMs) {
      latestMs = parsed;
      latestValue = value;
    }
  }
  return latestValue;
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

  const keeperValidatedAt = keeper?.enabled === true && keeper?.last_status === 'healthy'
    ? latestValidationTimestamp(keeper.last_check_at, keeper.last_refresh_at)
    : null;
  // A healthy Keeper check is a real validation. Always use the newest
  // successful timestamp instead of preferring an older snapshot timestamp.
  const effectiveValidatedAt = latestValidationTimestamp(session.last_validated_at, keeperValidatedAt);
  const ageMs = validationAge(effectiveValidatedAt, nowMs);
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

  const keeperNeedsSetup = !keeper
    || keeper.enabled !== true
    || !['healthy', 'refreshing'].includes(String(keeper.last_status || ''));

  if (ageMs > SESSION_VALIDATION_STALE_MS) {
    return {
      usable: true,
      needsAttention: true,
      severity: 'warning',
      status: 'stale_validation',
      reason: 'La última comprobación tiene más de 24 horas. La sesión sigue habilitada y solo se bloqueará si Keeper o una prueba real confirma que la web pidió acceso otra vez.',
      validatedAt: effectiveValidatedAt,
      ageMs,
    };
  }

  if (ageMs > SESSION_VALIDATION_WARN_MS || keeperNeedsSetup) {
    let reason = 'Conviene volver a comprobar esta sesión, pero seguirá habilitada mientras no exista una confirmación real de cierre de sesión.';
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
      validatedAt: effectiveValidatedAt,
      ageMs,
    };
  }

  return {
    usable: true,
    needsAttention: false,
    severity: 'ok',
    status: 'valid',
    reason: null,
    validatedAt: effectiveValidatedAt,
    ageMs,
  };
}
