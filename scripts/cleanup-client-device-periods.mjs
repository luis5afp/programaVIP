import fs from 'node:fs';

function replaceAllChecked(file, from, to, minCount = 1) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(from).length - 1;
  if (count < minCount) throw new Error(`Expected at least ${minCount} matches in ${file}, got ${count}`);
  fs.writeFileSync(file, source.split(from).join(to));
}

replaceAllChecked(
  'cloudflare/lib/auth.ts',
  'userflex_plans?select=id,name,duration_days,max_devices,max_profiles,enabled',
  'userflex_plans?select=id,name,duration_days,max_profiles,enabled',
  1,
);
replaceAllChecked(
  'cloudflare/lib/auth.ts',
  'Se alcanzó el máximo de dispositivos del plan.',
  'Se alcanzó el máximo de dispositivos permitido para este cliente.',
  1,
);
replaceAllChecked(
  'cloudflare/lib/admin.ts',
  'userflex_plans?select=id,name,duration_days,max_devices,max_profiles,enabled,created_at,updated_at',
  'userflex_plans?select=id,name,duration_days,max_profiles,enabled,created_at,updated_at',
  1,
);
console.log('Cleaned up device-limit wording and plan payloads.');
