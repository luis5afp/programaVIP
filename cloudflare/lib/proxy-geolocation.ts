import type { ProxyValidationResult } from './proxy-validation';

type Geo = {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
};

function cleanText(value: unknown, max = 120) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function cleanCountryCode(value: unknown) {
  const code = cleanText(value, 2);
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

async function ipApiCo(ip: string): Promise<Geo | null> {
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: 'application/json', 'User-Agent': 'userFLEX-Proxy-Validator/1.1' },
      signal: AbortSignal.timeout(4_500),
    });
    if (!response.ok) return null;
    const value: any = await response.json();
    if (value?.error === true) return null;
    const geo = {
      countryCode: cleanCountryCode(value?.country_code || value?.country),
      country: cleanText(value?.country_name),
      region: cleanText(value?.region),
      city: cleanText(value?.city),
      timezone: cleanText(value?.timezone),
    };
    return geo.countryCode || geo.country || geo.region || geo.city || geo.timezone ? geo : null;
  } catch {
    return null;
  }
}

async function ipWhoIs(ip: string): Promise<Geo | null> {
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'userFLEX-Proxy-Validator/1.1' },
      signal: AbortSignal.timeout(4_500),
    });
    if (!response.ok) return null;
    const value: any = await response.json();
    if (value?.success === false) return null;
    const geo = {
      countryCode: cleanCountryCode(value?.country_code),
      country: cleanText(value?.country),
      region: cleanText(value?.region),
      city: cleanText(value?.city),
      timezone: cleanText(value?.timezone?.id || value?.timezone),
    };
    return geo.countryCode || geo.country || geo.region || geo.city || geo.timezone ? geo : null;
  } catch {
    return null;
  }
}

export async function enrichProxyLocation(result: ProxyValidationResult): Promise<ProxyValidationResult> {
  if (!result.publicIp) return result;
  if (result.countryCode || result.country || result.region || result.city || result.timezone) return result;

  const geo = await ipApiCo(result.publicIp) || await ipWhoIs(result.publicIp);
  if (!geo) return result;

  return {
    ...result,
    countryCode: geo.countryCode,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    timezone: geo.timezone,
  };
}
