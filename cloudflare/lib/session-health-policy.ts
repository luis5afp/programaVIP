export type ManagedSessionHealthStatus =
  | 'valid'
  | 'pending_validation'
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
  if (!session) {
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

  if (session.status === 'needs_auth') {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'needs_renewal',
      reason: keeper?.last_error || 'Un acceso real del cliente confirmó que esta sesión ya no permite entrar con normalidad.',
      validatedAt: session.last_validated_at || null,
      ageMs: validationAge(session.last_validated_at, nowMs),
    };
  }

  if (session.status !== 'ready') {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'not_configured',
      reason: 'No hay una sesión central lista para este perfil.',
      validatedAt: session.last_validated_at || null,
      ageMs: validationAge(session.last_validated_at, nowMs),
    };
  }

  if (keeper?.enabled === true && keeper?.last_status === 'needs_admin') {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'needs_renewal',
      reason: keeper?.last_error || 'La web volvió a solicitar inicio de sesión durante un acceso real.',
      validatedAt: session.last_validated_at || null,
      ageMs: validationAge(session.last_validated_at, nowMs),
    };
  }

  const validatedAt = session.last_validated_at || null;
  const ageMs = validationAge(validatedAt, nowMs);
  if (ageMs === null) {
    return {
      usable: false,
      needsAttention: true,
      severity: 'critical',
      status: 'pending_validation',
      reason: 'La sesión está guardada pero todavía no completó su validación inicial.',
      validatedAt: null,
      ageMs: null,
    };
  }

  // Validation is intentionally one-time. A validated session never expires
  // because of age. It is revoked only when a real client access confirms that
  // authentication no longer works.
  return {
    usable: true,
    needsAttention: false,
    severity: 'ok',
    status: 'valid',
    reason: null,
    validatedAt,
    ageMs,
  };
}
