import assert from 'node:assert/strict';
import {
  SessionMaterialValidationError,
  buildImportedCookieMaterial,
  inspectCookieImport,
  validateCapturedMaterialData,
} from '../cloudflare/lib/session-material.ts';

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://www.netflix.com/browse',
};

const mixed = [
  {
    name: 'NetflixId',
    value: 'netflix-id-value',
    domain: '.netflix.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    expirationDate: 4102444800,
  },
  {
    name: 'SecureNetflixId',
    value: 'secure-netflix-id-value',
    domain: '.netflix.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    expirationDate: 4102444800,
  },
  {
    name: 'google-cookie',
    value: 'other-site',
    domain: '.google.com',
    path: '/',
    secure: true,
    expirationDate: 4102444800,
  },
  {
    name: 'expired-cookie',
    value: 'old',
    domain: '.netflix.com',
    path: '/',
    expirationDate: 1000,
  },
  {
    name: '',
    value: 'invalid',
    domain: '.netflix.com',
  },
];

const inspection = inspectCookieImport(profile.url, mixed);
assert.equal(inspection.format, 'cookie-array');
assert.equal(inspection.totalCookies, 5);
assert.equal(inspection.matchingCookies, 2);
assert.equal(inspection.ignoredCookies, 1);
assert.equal(inspection.expiredCookies, 1);
assert.equal(inspection.invalidCookies, 1);
assert.equal(inspection.domains.find((item) => item.domain === 'netflix.com')?.matchesProfile, true);
assert.equal(inspection.domains.find((item) => item.domain === 'google.com')?.matchesProfile, false);

const built = buildImportedCookieMaterial(profile, mixed);
assert.equal(built.material.format, 'userflex-browser-session-v2');
assert.equal(built.material.profileId, profile.id);
assert.equal(built.material.allowedOrigin, 'https://www.netflix.com');
assert.equal(built.material.cookies.length, 2);
assert.deepEqual(
  built.material.cookies.map((cookie) => cookie.name).sort(),
  ['NetflixId', 'SecureNetflixId'].sort(),
);
validateCapturedMaterialData(profile, built.material);

const playwright = {
  cookies: undefined,
  storageState: {
    cookies: [
      {
        name: 'session',
        value: 'abc',
        domain: '.example.com',
        path: '/',
        expires: 4102444800,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ],
    origins: [],
  },
};
const playwrightInspection = inspectCookieImport('https://app.example.com/', playwright);
assert.equal(playwrightInspection.format, 'playwright-storage-state');
assert.equal(playwrightInspection.matchingCookies, 1);
assert.equal(playwrightInspection.cookies[0].secure, true);
assert.equal(playwrightInspection.cookies[0].sameSite, 'None');

const urlCookie = inspectCookieImport('https://portal.example.org/', [
  {
    name: 'url-derived',
    value: '1',
    url: 'https://example.org/path',
    path: '/',
    expires: 4102444800000,
  },
]);
assert.equal(urlCookie.matchingCookies, 1);
assert.equal(urlCookie.cookies[0].domain, '.example.org');
assert.equal(urlCookie.cookies[0].expirationDate, 4102444800);

assert.throws(
  () => buildImportedCookieMaterial(
    { id: profile.id, url: 'https://amazon.com/' },
    mixed,
  ),
  (error: unknown) => error instanceof SessionMaterialValidationError
    && error.code === 'COOKIE_IMPORT_NO_MATCH',
);

assert.throws(
  () => validateCapturedMaterialData(profile, {
    ...built.material,
    cookies: [
      ...built.material.cookies,
      { name: 'cross-site', value: 'x', domain: '.google.com', path: '/' },
    ],
  }),
  (error: unknown) => error instanceof SessionMaterialValidationError
    && error.code === 'SESSION_COOKIE_DOMAIN_MISMATCH',
);

console.log('Cookie JSON import: OK');
