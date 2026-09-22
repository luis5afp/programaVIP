const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';
const OPENAI_AUTH_ORIGIN = 'https://auth.openai.com';

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

export function isTrustedGoogleAccountsHost(host) {
  const normalized = normalizeHost(host);
  if (normalized === 'accounts.google.com') return true;
  return /^accounts\.google\.(?:[a-z]{2}|(?:com|co)\.[a-z]{2})$/i.test(normalized);
}

function isGoogleServiceHost(host) {
  const normalized = normalizeHost(host);
  return normalized === 'google.com' || normalized.endsWith('.google.com');
}

function isOpenAiServiceHost(host) {
  const normalized = normalizeHost(host);
  return normalized === 'chatgpt.com'
    || normalized.endsWith('.chatgpt.com')
    || normalized === 'openai.com'
    || normalized.endsWith('.openai.com');
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
  if (target.protocol === 'https:' && isOpenAiServiceHost(target.hostname)) {
    origins.add(OPENAI_AUTH_ORIGIN);
  }
  return [...origins];
}

export function canonicalGoogleAccountsUrl(value) {
  try {
    const target = new URL(String(value || ''));
    const host = normalizeHost(target.hostname);
    if (target.protocol !== 'https:' || host === 'accounts.google.com') return null;
    if (!isTrustedGoogleAccountsHost(host)) return null;
    if (!/^\/accounts\/SetSID(?:\/|$)/i.test(target.pathname)) return null;
    target.hostname = 'accounts.google.com';
    return target.toString();
  } catch {
    return null;
  }
}

export function credentialAutofillAllowsUrl(value, allowedOrigins) {
  try {
    const target = new URL(String(value || ''));
    if (!Array.isArray(allowedOrigins)) return false;
    if (allowedOrigins.includes(target.origin)) return true;
    return target.protocol === 'https:'
      && allowedOrigins.includes(GOOGLE_AUTH_ORIGIN)
      && isTrustedGoogleAccountsHost(target.hostname);
  } catch {
    return false;
  }
}
