import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../cloudflare/lib/profile-proxy-defaults.ts', import.meta.url), 'utf8');

assert.match(source, /requiresManagedSnapshotRevalidation/);
assert.match(source, /markSnapshotForRevalidation/);
assert.match(source, /expected_egress_ip:\s*null/);
assert.match(source, /last_validated_at:\s*null/);
assert.match(source, /session_ready:\s*true/);
assert.doesNotMatch(
  source,
  /userflex_profile_sessions\?profile_id=eq\.\$\{profileId\}[\s\S]{0,200}method:\s*'DELETE'/,
  'changing a proxy must not delete the active managed snapshot',
);
assert.match(source, /snapshot_revalidation_required/);

console.log('Managed snapshot survives proxy changes: OK');
