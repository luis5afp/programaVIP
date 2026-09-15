import fs from 'node:fs';

function mustReplace(file, from, to) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`Missing expected text in ${file}: ${from.slice(0, 100)}`);
  fs.writeFileSync(file, source.replace(from, to));
}

function replaceAllChecked(file, from, to, minCount = 1) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(from).length - 1;
  if (count < minCount) throw new Error(`Expected at least ${minCount} matches in ${file}, got ${count}: ${from.slice(0, 100)}`);
  fs.writeFileSync(file, source.split(from).join(to));
}

// Types: device limit belongs to the client, not to the plan.
mustReplace('src/types.ts',
`  duration_days: number | null;\n  max_devices: number;\n  max_profiles: number;`,
`  duration_days: number | null;\n  max_profiles: number;`);
mustReplace('src/types.ts',
`  status: ClientStatus;\n  allow_external_browsing: boolean;`,
`  status: ClientStatus;\n  max_devices: number;\n  allow_external_browsing: boolean;`);

// API inputs.
mustReplace('src/api.ts',
`      phone?: string;\n      planId: string;`,
`      phone?: string;\n      maxDevices: number;\n      planId: string;`);
mustReplace('src/api.ts',
`    update: (id: string, input: Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status' | 'allow_external_browsing'>>) =>`,
`    update: (id: string, input: Partial<Pick<Client, 'name' | 'email' | 'phone' | 'status' | 'max_devices' | 'allow_external_browsing'>>) =>`);

// Plans UI: explicit period selector drives duration; predefined choices lock the day field.
mustReplace('src/views/PlansView.tsx',
`type Editor = Plan | 'new' | null;\n\nfunction profileLabel(profile: Profile) {`,
`type Editor = Plan | 'new' | null;\ntype PeriodValue = '30' | '60' | '90' | '180' | '365' | 'permanent' | 'custom';\n\nfunction periodFromDays(days: number | null): PeriodValue {\n  if (days === null) return 'permanent';\n  if ([30, 60, 90, 180, 365].includes(days)) return String(days) as PeriodValue;\n  return 'custom';\n}\n\nfunction durationDisplay(days: number | null) {\n  if (days === null) return 'Permanente';\n  const labels: Record<number, string> = {\n    30: '1 mes',\n    60: '2 meses',\n    90: '3 meses',\n    180: '6 meses',\n    365: '1 año',\n  };\n  return labels[days] ? \`${'${labels[days]} · ${days} días'}\` : \`${'${days} días · personalizado'}\`;\n}\n\nfunction profileLabel(profile: Profile) {`);
mustReplace('src/views/PlansView.tsx',
`  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);\n  const [error, setError] = useState<string | null>(null);`,
`  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);\n  const [period, setPeriod] = useState<PeriodValue>('30');\n  const [durationDays, setDurationDays] = useState('30');\n  const [error, setError] = useState<string | null>(null);`);
mustReplace('src/views/PlansView.tsx',
`  function openEditor(next: Exclude<Editor, null>) {\n    setEditor(next);\n    setSelectedProfileIds(next === 'new' ? [] : [...(next.profile_ids || [])]);\n  }\n\n  function closeEditor() {\n    setEditor(null);\n    setSelectedProfileIds([]);\n  }`,
`  function openEditor(next: Exclude<Editor, null>) {\n    setEditor(next);\n    setSelectedProfileIds(next === 'new' ? [] : [...(next.profile_ids || [])]);\n    const days = next === 'new' ? 30 : next.duration_days;\n    setPeriod(periodFromDays(days));\n    setDurationDays(days === null ? '' : String(days));\n  }\n\n  function closeEditor() {\n    setEditor(null);\n    setSelectedProfileIds([]);\n    setPeriod('30');\n    setDurationDays('30');\n  }`);
mustReplace('src/views/PlansView.tsx',
`    const form = new FormData(event.currentTarget);\n    const durationRaw = String(form.get('durationDays') || '').trim();\n    const input = {\n      name: String(form.get('name') || '').trim(),\n      duration_days: durationRaw ? Number(durationRaw) : null,\n      max_devices: Number(form.get('maxDevices') || 1),\n      max_profiles: selectedProfileIds.length,`,
`    const form = new FormData(event.currentTarget);\n    const durationValue = period === 'permanent' ? null : Number(durationDays);\n    if (durationValue !== null && (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 3650)) {\n      setError('La duración personalizada debe estar entre 1 y 3650 días.');\n      return;\n    }\n    const input = {\n      name: String(form.get('name') || '').trim(),\n      duration_days: durationValue,\n      max_profiles: selectedProfileIds.length,`);
mustReplace('src/views/PlansView.tsx',
`        description="Define duración, dispositivos y exactamente qué perfiles/webs incluye cada plan."`,
`        description="Define el período y exactamente qué perfiles/webs incluye cada plan. El límite de dispositivos se administra por cliente."`);
mustReplace('src/views/PlansView.tsx',
`                  <th>Duración</th>\n                  <th>Dispositivos</th>\n                  <th>Perfiles incluidos</th>`,
`                  <th>Período</th>\n                  <th>Perfiles incluidos</th>`);
mustReplace('src/views/PlansView.tsx',
`                      <td>{plan.duration_days === null ? 'Sin límite definido' : \`${'${plan.duration_days} días'}\`}</td>\n                      <td>{plan.max_devices}</td>`,
`                      <td>{durationDisplay(plan.duration_days)}</td>`);
mustReplace('src/views/PlansView.tsx',
`            <Field label="Duración (días)" help="Déjalo vacío si la fecha se definirá solo por suscripción.">\n              <input className="input" name="durationDays" type="number" min="1" max="3650" defaultValue={current?.duration_days ?? 30} />\n            </Field>\n            <Field label="Máximo de dispositivos">\n              <input className="input" name="maxDevices" type="number" min="1" max="50" defaultValue={current?.max_devices ?? 1} required />\n            </Field>`,
`            <Field label="Período">\n              <select\n                className="select"\n                value={period}\n                onChange={(event) => {\n                  const next = event.target.value as PeriodValue;\n                  setPeriod(next);\n                  if (next === 'permanent') setDurationDays('');\n                  else if (next !== 'custom') setDurationDays(next);\n                  else if (!durationDays) setDurationDays('30');\n                }}\n              >\n                <option value="30">1 mes</option>\n                <option value="60">2 meses</option>\n                <option value="90">3 meses</option>\n                <option value="180">6 meses</option>\n                <option value="365">1 año</option>\n                <option value="permanent">Permanente</option>\n                <option value="custom">Configurar</option>\n              </select>\n            </Field>\n            <Field\n              label="Duración (días)"\n              help={period === 'custom' ? 'Configura manualmente entre 1 y 3650 días.' : period === 'permanent' ? 'Permanente: el plan no tiene una duración fija en días.' : 'Se calcula automáticamente según el período seleccionado.'}\n            >\n              <input\n                className="input"\n                name="durationDays"\n                type="number"\n                min="1"\n                max="3650"\n                value={durationDays}\n                onChange={(event) => setDurationDays(event.target.value)}\n                disabled={period !== 'custom'}\n                placeholder={period === 'permanent' ? 'Sin límite' : undefined}\n                required={period === 'custom'}\n              />\n            </Field>`);

// Clients UI: create/edit the device limit here and show it in the client list.
mustReplace('src/views/ClientsView.tsx',
`        phone: String(form.get('phone') || '').trim(),\n        planId: String(form.get('planId') || ''),`,
`        phone: String(form.get('phone') || '').trim(),\n        maxDevices: Number(form.get('maxDevices') || 1),\n        planId: String(form.get('planId') || ''),`);
mustReplace('src/views/ClientsView.tsx',
`        status: String(form.get('status')) as Client['status'],\n        allow_external_browsing: form.get('allowExternalBrowsing') === 'on',`,
`        status: String(form.get('status')) as Client['status'],\n        max_devices: Number(form.get('maxDevices') || 1),\n        allow_external_browsing: form.get('allowExternalBrowsing') === 'on',`);
mustReplace('src/views/ClientsView.tsx',
`          client.subscription?.plan?.name || '',\n          client.status,`,
`          client.subscription?.plan?.name || '',\n          String(client.max_devices || 1),\n          client.status,`);
mustReplace('src/views/ClientsView.tsx',
`                  <th>Plan / vencimiento</th>\n                  <th>Estado</th>`,
`                  <th>Plan / vencimiento</th>\n                  <th>Dispositivos</th>\n                  <th>Estado</th>`);
mustReplace('src/views/ClientsView.tsx',
`                      </td>\n                      <td>\n                        <Badge tone={client.status === 'active' && !expired ? 'ok' : 'bad'}>`,
`                      </td>\n                      <td>\n                        <div className="table-primary">Máx. {client.max_devices || 1}</div>\n                        <div className="table-secondary">por cliente</div>\n                      </td>\n                      <td>\n                        <Badge tone={client.status === 'active' && !expired ? 'ok' : 'bad'}>`);
mustReplace('src/views/ClientsView.tsx',
`            <Field label="Teléfono"><input className="input" name="phone" maxLength={40} /></Field>\n            <Field label="Plan">`,
`            <Field label="Teléfono"><input className="input" name="phone" maxLength={40} /></Field>\n            <Field label="Máximo de dispositivos" help="Límite exclusivo para este cliente."><input className="input" name="maxDevices" type="number" min="1" max="50" defaultValue="1" required /></Field>\n            <Field label="Plan">`);
mustReplace('src/views/ClientsView.tsx',
`            <Field label="Teléfono"><input className="input" name="phone" defaultValue={editClient.phone || ''} maxLength={40} /></Field>\n            <Field label="Estado">\n              <select className="select" name="status" defaultValue={editClient.status}>\n                <option value="active">Activo</option>\n                <option value="suspended">Suspendido</option>\n              </select>\n            </Field>`,
`            <Field label="Teléfono"><input className="input" name="phone" defaultValue={editClient.phone || ''} maxLength={40} /></Field>\n            <Field label="Máximo de dispositivos" help="Controla cuántos equipos activos puede registrar este cliente.">\n              <input className="input" name="maxDevices" type="number" min="1" max="50" defaultValue={editClient.max_devices || 1} required />\n            </Field>\n            <Field label="Estado" className="span-2">\n              <select className="select" name="status" defaultValue={editClient.status}>\n                <option value="active">Activo</option>\n                <option value="suspended">Suspendido</option>\n              </select>\n            </Field>`);

// Plan API no longer accepts or exposes a plan-level device limit.
mustReplace('cloudflare/lib/plan-access.ts',
`    'userflex_plans?select=id,name,duration_days,max_devices,max_profiles,enabled,created_at,updated_at&order=name.asc',`,
`    'userflex_plans?select=id,name,duration_days,max_profiles,enabled,created_at,updated_at&order=name.asc',`);
mustReplace('cloudflare/lib/plan-access.ts',
`      duration_days: body.duration_days === null ? null : integer(body.duration_days, 1, 3650, 'duration_days'),\n      max_devices: integer(body.max_devices, 1, 50, 'max_devices'),\n      max_profiles: integer(body.max_profiles, 1, 500, 'max_profiles'),`,
`      duration_days: body.duration_days === null ? null : integer(body.duration_days, 1, 3650, 'duration_days'),\n      max_profiles: integer(body.max_profiles, 1, 500, 'max_profiles'),`);
mustReplace('cloudflare/lib/plan-access.ts',
`    if (body.max_devices !== undefined) patch.max_devices = integer(body.max_devices, 1, 50, 'max_devices');\n`,
``);

// Admin client API: expose and update the client-level device limit.
replaceAllChecked('cloudflare/lib/admin.ts',
`id,name,email,phone,status,allow_external_browsing,created_at,updated_at`,
`id,name,email,phone,status,max_devices,allow_external_browsing,created_at,updated_at`, 2);
mustReplace('cloudflare/lib/admin.ts',
`    const phone = optional(body.phone, 40);\n    const planId = uuid(body.planId, 'planId');`,
`    const phone = optional(body.phone, 40);\n    const maxDevices = integer(body.maxDevices ?? 1, 1, 50, 'maxDevices');\n    const planId = uuid(body.planId, 'planId');`);
mustReplace('cloudflare/lib/admin.ts',
`    const id = Array.isArray(result) ? result[0] : result;\n    await audit(env, request, 'admin', admin.userId, 'client.create', 'client', String(id));`,
`    const id = Array.isArray(result) ? result[0] : result;\n    await sb(env, \`userflex_clients?id=eq.${'${id}'}\`, {\n      method: 'PATCH',\n      headers: { Prefer: 'return=minimal' },\n      body: JSON.stringify({ max_devices: maxDevices, updated_at: new Date().toISOString() }),\n    });\n    await audit(env, request, 'admin', admin.userId, 'client.create', 'client', String(id), { maxDevices });`);
mustReplace('cloudflare/lib/admin.ts',
`    if (body.phone !== undefined) patch.phone = optional(body.phone, 40);\n    if (body.allow_external_browsing !== undefined) patch.allow_external_browsing = Boolean(body.allow_external_browsing);`,
`    if (body.phone !== undefined) patch.phone = optional(body.phone, 40);\n    if (body.max_devices !== undefined) patch.max_devices = integer(body.max_devices, 1, 50, 'max_devices');\n    if (body.allow_external_browsing !== undefined) patch.allow_external_browsing = Boolean(body.allow_external_browsing);`);

// Client authentication uses the per-client limit.
replaceAllChecked('cloudflare/lib/auth.ts',
`id,name,email,status,allow_external_browsing,updated_at`,
`id,name,email,status,max_devices,allow_external_browsing,updated_at`, 2);
mustReplace('cloudflare/lib/auth.ts',
`p_max_devices:plan.max_devices`,
`p_max_devices:Number(client.max_devices||1)`);

// Worker version for this server-side behavior change.
mustReplace('cloudflare/worker.ts', `const APP_VERSION = '1.2.5';`, `const APP_VERSION = '1.2.6';`);

console.log('Applied client device limits and plan period selector changes.');
