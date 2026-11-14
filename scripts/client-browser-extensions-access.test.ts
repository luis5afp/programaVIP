import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBrowserExtensionsAccess, browserStartupArgument } from '../client-app/browser-engine/extension-ui-mode.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const admin = read('cloudflare/lib/admin.ts');
const auth = read('cloudflare/lib/auth.ts');
const client = read('cloudflare/lib/client.ts');
const engine = read('client-app/browser-engine/kaizen-engine.js');
const main = read('client-app/main.js');
const view = read('src/views/ClientsView.tsx');
const schema = read('cloudflare/lib/client-browser-access.ts');

assert.equal(normalizeBrowserExtensionsAccess(undefined), 'restricted', 'unknown mode must default to restricted');
assert.equal(normalizeBrowserExtensionsAccess('full'), 'full');
assert.equal(normalizeBrowserExtensionsAccess('restricted'), 'restricted');
assert.equal(normalizeBrowserExtensionsAccess('FULL'), 'restricted');
assert.equal(browserStartupArgument('https://example.com', 'restricted'), '--app=https://example.com');
assert.equal(browserStartupArgument('about:blank', 'restricted'), '--app=about:blank');
assert.equal(browserStartupArgument('https://example.com', 'full'), 'https://example.com');

assert.match(schema, /DEFAULT 'restricted'/, 'new and existing customer rows start restricted');
assert.match(admin, /browser_extensions_access = body.browser_extensions_access/, 'admin can update permissions');
assert.match(view, /name="browserExtensionsAccess"/, 'Admin exposes per-client permission');
assert.match(auth, /browser_extensions_access,updated_at/, 'authoritative client sessions include permission');
assert.match(client, /browserExtensionsAccess: browserExtensionsAccess\(id.client.browser_extensions_access\)/,
  'profile launch/catalog/heartbeat must return the server permission');
assert.match(main, /browserExtensionsAccess: launch\?\.client\?\.browserExtensionsAccess/,
  'desktop must use the permission from authenticated launch, not from a local UI toggle');
assert.match(engine, /args.push\(browserStartupArgument\(initialUrl, browserExtensionsAccess\)\)/);
assert.match(engine, /\`--load-extension=\${extensionList}\`/, 'restricting browser UI must not prevent extension loading');
assert.match(engine, /if \(extensionsUiAccess === 'restricted'\)/, 'restricted UI still protects internal management tabs');
assert.match(engine, /extensionsUiChanged/, 'live clients must reconcile a server-side permission downgrade');
console.log('Per-client Edge extensions UI permission: OK');
