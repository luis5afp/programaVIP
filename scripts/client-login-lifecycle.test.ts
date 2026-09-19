import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');

const start = main.indexOf('async function returnToLogin(');
const end = main.indexOf('\nfunction proxyRules(', start);
assert.ok(start >= 0 && end > start, 'returnToLogin must be discoverable');
const transition = main.slice(start, end);

const clearPos = transition.indexOf('await clearAuth()');
const createPos = transition.indexOf('const loginWindow = createMainWindow()');
const closePos = transition.indexOf('closePrivateBrowser()');

assert.ok(clearPos >= 0, 'auth must be cleared when invalidated');
assert.ok(createPos > clearPos, 'login window must be created after auth is cleared');
assert.ok(closePos > createPos, 'workspace must close only after the login window exists');
assert.match(
  transition,
  /pendingAuthInvalidation\s*=\s*message/,
  'auth invalidation reason must be preserved for the newly created login renderer',
);

assert.match(
  worker,
  /path === '\/api\/client\/auth'[\s\S]{0,180}assertMinimumUserflowVersion\(request\)/,
  'outdated userFLOW must be rejected before client login succeeds',
);
assert.match(
  worker,
  /path === '\/api\/client\/catalog'[\s\S]{0,180}assertMinimumUserflowVersion\(request\)/,
  'outdated stored sessions must be rejected before entering the catalog',
);

console.log('Client login/window lifecycle regression: OK');
