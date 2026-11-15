import { Env, HttpError } from './core';

export type BrowserExtensionsAccess = 'restricted' | 'full';

// The Worker can start before SQL migrations are applied in Neon. Bootstrap
// this additive column exactly once per isolate to keep subsequent client
// authentication and profile catalog reads free of DDL.
let readyFor = '';
let readyPromise: Promise<void> | null = null;

export function browserExtensionsAccess(value: unknown): BrowserExtensionsAccess {
  return value === 'full' ? 'full' : 'restricted';
}

export async function ensureClientBrowserAccessSchema(env: Env): Promise<void> {
  const databaseUrl = String(env.NEON_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new HttpError(503, 'NEON_CONFIG_MISSING', 'Neon no está configurado.');
  if (readyFor === databaseUrl && readyPromise) return await readyPromise;
  readyFor = databaseUrl;
  readyPromise = (async () => {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    // Existing databases already have this column. A read-only probe avoids
    // taking a PostgreSQL DDL lock on every cold Worker isolate; Neon can
    // otherwise stall concurrent admin/client requests during startup.
    try {
      await sql.query('SELECT browser_extensions_access FROM public.userflex_clients LIMIT 0');
    } catch (error: any) {
      if (String(error?.code || '') !== '42703') throw error;
      // Only older databases without the column require a one-time migration.
      await sql.query(
        "ALTER TABLE public.userflex_clients ADD COLUMN IF NOT EXISTS browser_extensions_access text NOT NULL DEFAULT 'restricted'"
      );
    }
  })().catch((error: any) => {
    readyPromise = null;
    console.error('Client browser access schema bootstrap failed', String(error?.code || ''), String(error?.message || error).slice(0, 160));
    throw new HttpError(502, 'CLIENT_BROWSER_ACCESS_SCHEMA_ERROR', 'No se pudo preparar el control de acceso al navegador.');
  });
  return await readyPromise;
}
