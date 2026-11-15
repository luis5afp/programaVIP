import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const admin = read('cloudflare/lib/admin.ts');
const schema = read('cloudflare/lib/client-browser-access.ts');
const view = read('src/views/ClientsView.tsx');
const api = read('src/api.ts');
const descriptions = read('src/error-messages.ts');

const createStart = admin.indexOf("if (path === '/api/clients' && method === 'POST')");
const createEnd = admin.indexOf("const credentialsMatch =", createStart);
assert.ok(createStart >= 0 && createEnd > createStart, 'find client creation route');
const create = admin.slice(createStart, createEnd);
assert.match(create, /rpc\/userflex_create_client/, 'retain atomic credential and subscription creation');
assert.match(create, /browser_extensions_access: browserAccess/, 'save requested browser access');
assert.match(create, /return=representation/, 'confirm settings were saved');
assert.match(create, /catch \(error\) \{[\s\S]*?method: 'DELETE'/, 'compensate if settings PATCH fails');
assert.match(create, /CLIENT_CREATED_CONFIGURATION_INCOMPLETE/, 'warn if compensation fails');
assert.match(create, /catch \(auditError\)/, 'noncritical audit failure must not masquerade as failure to create customer');
assert.match(create, /catch \(enrichmentError\)/, 'detail enrichment failure must not cause duplicate customer retry');
assert.match(create, /return json\(\{ \.\.\.rows\[0\], credential:/, 'safe creation result when enrichment unavailable');
assert.match(schema, /SELECT browser_extensions_access FROM public\.userflex_clients LIMIT 0/,
  'check presence via read-only query on cold start');
assert.match(schema, /String\(error\?\.code \|\| ''\) !== '42703'/,
  'only run migration on a real missing-column error');
assert.match(view, /setError\(createError\?\.message/,
  'client form must show the central explanation instead of opaque error codes');
assert.match(api, /friendlyApiError\(\{/,
  'the API must describe failures before the client form shows them');
assert.match(descriptions, /Referencia para soporte:/,
  'unexpected problems must retain a support reference');
console.log('Client create response, rollback and schema bootstrap regression: OK');
