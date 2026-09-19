const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function isGoogleServiceHost(host) {
  const normalized = normalizeHost(host);
  return normalized === 'google.com' || normalized.endsWith('.google.com');
}

export function credentialAutofillOrigins(profileUrl, extensionStrategy = 'custom') {
  const target = new URL(String(profileUrl || ''));
  if (!['https:', 'http:'].includes(target.protocol)) {
    throw new Error('La URL del perfil no es compatible con autofill.');
  }

  const origins = new Set([target.origin]);
  if (String(extensionStrategy || '').toLowerCase() === 'google' || isGoogleServiceHost(target.hostname)) {
    origins.add(GOOGLE_AUTH_ORIGIN);
  }
  return [...origins];
}

export function credentialAutofillAllowsUrl(value, allowedOrigins) {
  try {
    const origin = new URL(String(value || '')).origin;
    return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}
