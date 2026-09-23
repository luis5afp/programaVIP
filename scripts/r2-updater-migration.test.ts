import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../cloudflare/lib/core.ts', import.meta.url), 'utf8');
const updates = readFileSync(new URL('../cloudflare/lib/client-updates.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../cloudflare/lib/client-release-admin.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const clientWorkflow = readFileSync(new URL('../.github/workflows/build-client-app.yml', import.meta.url), 'utf8');
const sessionWorkflow = readFileSync(new URL('../.github/workflows/build-session-manager.yml', import.meta.url), 'utf8');

assert.match(core, /CLIENT_RELEASES\?: R2BucketLike/);
assert.match(wrangler, /binding = "CLIENT_RELEASES"/);
assert.match(wrangler, /bucket_name = "userflex-client-releases"/);
assert.match(updates, /cloudflare-r2/);
assert.match(updates, /pruneClientReleaseStorage/);
assert.doesNotMatch(updates, /SUPABASE_URL/);
assert.doesNotMatch(updates, /storage\/v1\/object/);
assert.match(admin, /releaseBucket\(env\)/);
assert.doesNotMatch(admin, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(clientWorkflow, /Publish automatic updater feed to Cloudflare R2/);
assert.match(clientWorkflow, /r2 object put/);
assert.match(updates, /const KEEP_RELEASE_VERSIONS = 2;/);
assert.match(wrangler, /crons = \["0 \* \* \* \*"\]/);
assert.match(clientWorkflow, /Keep only two Client GitHub releases/);
assert.match(sessionWorkflow, /Keep only two Session Manager GitHub releases/);
assert.match(clientWorkflow, /retention-days: 1/);
assert.match(sessionWorkflow, /retention-days: 1/);
assert.match(clientWorkflow, /Build Windows installer[\s\S]{0,120}github\.event_name != 'pull_request'/);
assert.match(sessionWorkflow, /Build Windows installer[\s\S]{0,120}github\.event_name != 'pull_request'/);

console.log('Cloudflare R2 updater migration: OK');
