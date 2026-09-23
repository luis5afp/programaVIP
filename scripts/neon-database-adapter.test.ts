import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../cloudflare/lib/core.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../cloudflare/lib/neon-rest.ts', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(typeof pkg.dependencies['@neondatabase/serverless'], 'string');
assert.match(core, /NEON_DATABASE_URL\?: string/);
assert.match(core, /if \(!env\.NEON_DATABASE_URL\)/);
assert.match(core, /import\('\.\/neon-rest'\)/);
assert.doesNotMatch(core, /SUPABASE_/);
assert.doesNotMatch(core, /supabase/i);
assert.match(adapter, /sql\.query|client\(env\)\.query/);
assert.match(adapter, /DATABASE_UNBOUNDED_WRITE/);
assert.match(adapter, /on_conflict/);
assert.match(adapter, /DO UPDATE SET/);
assert.match(adapter, /resolution=ignore-duplicates/);
assert.match(adapter, /not\.is\.null/);
assert.match(adapter, /IN \(/);
assert.match(adapter, /NULLS LAST/);
assert.match(adapter, /value instanceof Date/);
assert.match(adapter, /toISOString\(\)/);

console.log('Neon database adapter compatibility: OK');
