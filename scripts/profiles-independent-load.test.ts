import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function load(options:');
const end = source.indexOf('  useEffect(() => {', start);
assert.ok(start >= 0 && end > start, 'profile load method must exist');
const load = source.slice(start, end);

assert.match(load, /api\.profiles\.list\(\)\s*\.then/, 'profiles must load independently');
assert.match(load, /Promise\.allSettled\(\[/, 'optional data must not prevent listing profiles');
assert.doesNotMatch(load, /Promise\.all\(\[\s*api\.profiles\.list\(\)/, 'all ten requests must not be one all-or-nothing promise');
assert.match(load, /setProfiles\(rows\)/, 'successful profile response must immediately populate the list');
assert.match(load, /setProfileLoadStatus\('ready'\)/, 'successful response is distinguished from an empty/error state');
assert.match(load, /setProfileLoadStatus\('error'\)/, 'failed response must be visible as an error rather than an empty list');
assert.match(load, /setProfileLoadError\(/, 'real API failures must have a message');
assert.doesNotMatch(load, /setProfiles\(\[\]\)/, 'transient errors must not discard already loaded profiles');
assert.match(load, /profileLoadSequence\.current/, 'stale requests must not overwrite newer data');
assert.match(source, /profileLoadStatus === 'loading'/, 'show loading state');
assert.match(source, /profileLoadStatus === 'error'/, 'show connection error state');
assert.match(source, /Reintentar carga/, 'offer user retry');
assert.match(source, /No hay perfiles/, 'only a confirmed empty response shows no profiles');

console.log('Independent profile loading and error/empty-state distinction: OK');
