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

function useful(geo: Geo | null) {
  return Boolean(geo && (geo.countryCode || geo.country || geo.region || geo.city || geo.timezone));
}

async function fetchJson(url: string, timeoutMs = 4_500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'userFLEX-Proxy-Validator/1.2',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function geoJs(ip: string): Promise<Geo | null> {
  const value = await fetchJson(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`);
  if (!value) return null;
  const geo: Geo = {
    countryCode: cleanCountryCode(value?.country_code),
    country: cleanText(value?.country),
    region: cleanText(value?.region),
    city: cleanText(value?.city),
    timezone: cleanText(value?.timezone),
  };
  return useful(geo) ? geo : null;
}

async function ipWhoIs(ip: string): Promise<Geo | null> {
  const value = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (!value || value?.success === false) return null;
  const geo: Geo = {
    countryCode: cleanCountryCode(value?.country_code),
    country: cleanText(value?.country),
    region: cleanText(value?.region),
    city: cleanText(value?.city),
    timezone: cleanText(value?.timezone?.id || value?.timezone),
  };
  return useful(geo) ? geo : null;
}

async function ipApiCo(ip: string): Promise<Geo | null> {
  const value = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
  if (!value || value?.error === true) return null;
  const geo: Geo = {
    countryCode: cleanCountryCode(value?.country_code || value?.country),
    country: cleanText(value?.country_name),
    region: cleanText(value?.region),
    city: cleanText(value?.city),
    timezone: cleanText(value?.timezone),
  };
  return useful(geo) ? geo : null;
}

async function countriesDev(ip: string): Promise<Geo | null> {
  const value = await fetchJson(`https://countries.dev/ip/${encodeURIComponent(ip)}`);
  if (!value) return null;
  const geo: Geo = {
    countryCode: cleanCountryCode(value?.countryCode || value?.country?.cca2 || value?.country?.code),
    country: cleanText(value?.country?.name?.common || value?.country?.name || value?.countryName),
    region: null,
    city: null,
    timezone: null,
  };
  return useful(geo) ? geo : null;
}

function mergeGeo(primary: Geo | null, fallback: Geo | null): Geo | null {
  if (!primary && !fallback) return null;
  return {
    countryCode: primary?.countryCode || fallback?.countryCode || null,
    country: primary?.country || fallback?.country || null,
    region: primary?.region || fallback?.region || null,
    city: primary?.city || fallback?.city || null,
    timezone: primary?.timezone || fallback?.timezone || null,
  };
}

export async function enrichProxyLocation(result: ProxyValidationResult): Promise<ProxyValidationResult> {
  if (!result.publicIp) return result;
  if (result.countryCode && (result.country || result.city || result.timezone)) return result;

  // GeoJS is the primary source because it supports direct arbitrary-IP lookups over HTTPS
  // and returns country, city, region and IANA timezone without an API key.
  let geo = await geoJs(result.publicIp);

  // Fill any missing fields from additional providers instead of replacing good data.
  if (!geo?.countryCode || !geo?.country || !geo?.city || !geo?.timezone) {
    geo = mergeGeo(geo, await ipWhoIs(result.publicIp));
  }
  if (!geo?.countryCode || !geo?.country || !geo?.city || !geo?.timezone) {
    geo = mergeGeo(geo, await ipApiCo(result.publicIp));
  }

  // Last-resort country lookup: even if city-level providers are unavailable, this lets
  // the admin UI render the correct national flag instead of the generic globe.
  if (!geo?.countryCode || !geo?.country) {
    geo = mergeGeo(geo, await countriesDev(result.publicIp));
  }

  if (!geo) return result;

  return {
    ...result,
    countryCode: geo.countryCode || result.countryCode,
    country: geo.country || result.country,
    region: geo.region || result.region,
    city: geo.city || result.city,
    timezone: geo.timezone || result.timezone,
  };
}
