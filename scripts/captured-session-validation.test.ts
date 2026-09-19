import assert from 'node:assert/strict';
import { validateCapturedMaterialData } from '../cloudflare/lib/session-material.ts';

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://www.netflix.com/pe/',
};
const expires = Math.floor(Date.now() / 1000) + 3600;
const valid = {
  format: 'userflex-browser-session-v2',
  profileId: profile.id,
  allowedOrigin: 'https://www.netflix.com',
  capturedUrl: 'https://www.netflix.com/browse',
  cookies: [
    { name: 'NetflixId', value: 'netflix-id', domain: '.netflix.com', expires },
    { name: 'SecureNetflixId', value: 'secure-netflix-id', domain: '.netflix.com', expires },
  ],
  storage: { origin: 'https://www.netflix.com' },
};

assert.doesNotThrow(() => validateCapturedMaterialData(profile, valid));

function codeFor(material: any) {
  try {
    validateCapturedMaterialData(profile, material);
    return null;
  } catch (error: any) {
    return error?.code || error?.message;
  }
}

assert.equal(codeFor({ ...valid, profileId: '22222222-2222-4222-8222-222222222222' }), 'SESSION_PROFILE_MISMATCH');
assert.equal(codeFor({ ...valid, allowedOrigin: 'https://example.com' }), 'SESSION_ORIGIN_MISMATCH');
assert.equal(codeFor({ ...valid, capturedUrl: 'https://example.com/' }), 'SESSION_CAPTURE_URL_MISMATCH');
assert.equal(codeFor({ ...valid, storage: { origin: 'https://example.com' } }), 'SESSION_STORAGE_ORIGIN_MISMATCH');
assert.equal(
  codeFor({ ...valid, cookies: valid.cookies.filter((cookie) => cookie.name !== 'SecureNetflixId') }),
  'NETFLIX_AUTH_COOKIES_INVALID',
);
assert.equal(
  codeFor({
    ...valid,
    cookies: valid.cookies.map((cookie) => cookie.name === 'NetflixId' ? { ...cookie, expires: 1 } : cookie),
  }),
  'NETFLIX_AUTH_COOKIES_INVALID',
);

assert.doesNotThrow(() => validateCapturedMaterialData(
  { id: profile.id, url: 'https://chatgpt.com/' },
  {
    format: 'userflex-browser-session-v2',
    profileId: profile.id,
    allowedOrigin: 'https://chatgpt.com',
    capturedUrl: 'https://chatgpt.com/',
    cookies: [],
    storage: { origin: 'https://chatgpt.com' },
  },
));

console.log('Captured session validation: OK');
