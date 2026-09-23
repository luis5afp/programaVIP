import { neon } from '@neondatabase/serverless';
import { HttpError, type Env } from './core';

type QueryClient = ReturnType<typeof neon>;

let cachedUrl = '';
let cachedClient: QueryClient | null = null;

function client(env: Env): QueryClient {
  const url = String(env.NEON_DATABASE_URL || '').trim();
  if (!url) throw new HttpError(503, 'NEON_CONFIG_MISSING', 'Neon no está configurado.');
  if (!cachedClient || cachedUrl !== url) {
    cachedUrl = url;
    cachedClient = neon(url);
  }
  return cachedClient;
}

function ident(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new HttpError(400, 'DATABASE_QUERY_INVALID');
  return '"' + value.replace(/"/g, '""') + '"';
}

function selectedColumns(value: string | null) {
  if (!value || value === '*') return '*';
  const parts = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return '*';
  return parts.map(ident).join(', ');
}

function normalizeDatabaseValue(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDatabaseValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDatabaseValue(item)]),
    );
  }
  return value;
}

function runRows(result: any): any[] {
  const rows = Array.isArray(result) ? result : (Array.isArray(result?.rows) ? result.rows : []);
  return rows.map((row: any) => normalizeDatabaseValue(row));
}

function pushParam(values: any[], value: any) {
  values.push(value);
  return '$' + values.length;
}

function parseFilters(params: URLSearchParams, values: any[]) {
  const where: string[] = [];
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

  for (const [key, raw] of params.entries()) {
    if (reserved.has(key)) continue;
    const column = ident(key);

    if (raw === 'is.null') {
      where.push(`${column} IS NULL`);
      continue;
    }
    if (raw === 'not.is.null') {
      where.push(`${column} IS NOT NULL`);
      continue;
    }

    const inMatch = raw.match(/^in\.\((.*)\)$/s);
    if (inMatch) {
      const items = inMatch[1] ? inMatch[1].split(',').map((item) => item.trim()) : [];
      if (!items.length) {
        where.push('FALSE');
      } else {
        const refs = items.map((item) => pushParam(values, item));
        where.push(`${column} IN (${refs.join(', ')})`);
      }
      continue;
    }

    const match = raw.match(/^(eq|neq|gt|gte|lt|lte)\.(.*)$/s);
    if (!match) throw new HttpError(400, 'DATABASE_FILTER_INVALID');
    const [, op, value] = match;
    const operators: Record<string, string> = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    };
    where.push(`${column} ${operators[op]} ${pushParam(values, value)}`);
  }

  return where.length ? ' WHERE ' + where.join(' AND ') : '';
}

function parseOrder(value: string | null) {
  if (!value) return '';
  const clauses = value.split(',').map((item) => {
    const parts = item.trim().split('.');
    const column = ident(parts[0]);
    const direction = parts.includes('desc') ? 'DESC' : 'ASC';
    const nulls = parts.includes('nullslast') ? ' NULLS LAST'
      : parts.includes('nullsfirst') ? ' NULLS FIRST'
      : '';
    return `${column} ${direction}${nulls}`;
  });
  return clauses.length ? ' ORDER BY ' + clauses.join(', ') : '';
}

function parseLimit(params: URLSearchParams, values: any[]) {
  const raw = params.get('limit');
  if (!raw) return '';
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new HttpError(400, 'DATABASE_LIMIT_INVALID');
  return ' LIMIT ' + pushParam(values, limit);
}

function prefer(init: RequestInit) {
  return String(new Headers(init.headers).get('Prefer') || '').toLowerCase();
}

async function rpc(env: Env, name: string, init: RequestInit) {
  const fn = ident(name);
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const keys = Object.keys(body || {});
  const values: any[] = [];
  const args = keys.map((key) => `${ident(key)} => ${pushParam(values, body[key])}`);
  const query = `SELECT * FROM public.${fn}(${args.join(', ')})`;
  const rows = runRows(await client(env).query(query, values));

  if (rows.length === 1) {
    const keys = Object.keys(rows[0] || {});
    if (keys.length === 1 && keys[0] === name) return rows[0][name];
  }
  return rows;
}

async function selectRows(env: Env, table: string, params: URLSearchParams) {
  const values: any[] = [];
  const query = [
    'SELECT ',
    selectedColumns(params.get('select')),
    ' FROM public.',
    ident(table),
    parseFilters(params, values),
    parseOrder(params.get('order')),
    parseLimit(params, values),
  ].join('');
  return runRows(await client(env).query(query, values));
}

async function insertRows(env: Env, table: string, params: URLSearchParams, init: RequestInit) {
  const payload = init.body ? JSON.parse(String(init.body)) : {};
  const rows = Array.isArray(payload) ? payload : [payload];
  if (!rows.length) return [];

  const columns = Object.keys(rows[0] || {});
  if (!columns.length) throw new HttpError(400, 'DATABASE_INSERT_INVALID');
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!columns.includes(key)) throw new HttpError(400, 'DATABASE_INSERT_SHAPE_INVALID');
    }
  }

  const values: any[] = [];
  const tuples = rows.map((row) => '(' + columns.map((column) => pushParam(values, row[column] ?? null)).join(', ') + ')');
  let query = `INSERT INTO public.${ident(table)} (${columns.map(ident).join(', ')}) VALUES ${tuples.join(', ')}`;

  const conflictRaw = params.get('on_conflict');
  const preference = prefer(init);
  if (conflictRaw) {
    const conflict = conflictRaw.split(',').map((item) => item.trim()).filter(Boolean);
    if (!conflict.length) throw new HttpError(400, 'DATABASE_CONFLICT_INVALID');
    const conflictSql = conflict.map(ident).join(', ');
    if (preference.includes('resolution=ignore-duplicates')) {
      query += ` ON CONFLICT (${conflictSql}) DO NOTHING`;
    } else {
      const updates = columns.filter((column) => !conflict.includes(column));
      query += updates.length
        ? ` ON CONFLICT (${conflictSql}) DO UPDATE SET ${updates.map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`).join(', ')}`
        : ` ON CONFLICT (${conflictSql}) DO NOTHING`;
    }
  }

  const representation = preference.includes('return=representation');
  if (representation) query += ' RETURNING *';
  const result = runRows(await client(env).query(query, values));
  return representation ? result : null;
}

async function patchRows(env: Env, table: string, params: URLSearchParams, init: RequestInit) {
  const payload = init.body ? JSON.parse(String(init.body)) : {};
  const entries = Object.entries(payload || {});
  if (!entries.length) return [];

  const values: any[] = [];
  const sets = entries.map(([column, value]) => `${ident(column)} = ${pushParam(values, value)}`);
  const where = parseFilters(params, values);
  if (!where) throw new HttpError(400, 'DATABASE_UNBOUNDED_WRITE');
  const representation = prefer(init).includes('return=representation');
  const query = `UPDATE public.${ident(table)} SET ${sets.join(', ')}${where}${representation ? ' RETURNING *' : ''}`;
  const result = runRows(await client(env).query(query, values));
  return representation ? result : null;
}

async function deleteRows(env: Env, table: string, params: URLSearchParams, init: RequestInit) {
  const values: any[] = [];
  const where = parseFilters(params, values);
  if (!where) throw new HttpError(400, 'DATABASE_UNBOUNDED_WRITE');
  const representation = prefer(init).includes('return=representation');
  const query = `DELETE FROM public.${ident(table)}${where}${representation ? ' RETURNING *' : ''}`;
  const result = runRows(await client(env).query(query, values));
  return representation ? result : null;
}

export async function neonRest(env: Env, path: string, init: RequestInit = {}) {
  const [resourcePart, queryPart = ''] = path.split('?', 2);
  const method = String(init.method || 'GET').toUpperCase();

  if (resourcePart.startsWith('rpc/')) {
    if (method !== 'POST') throw new HttpError(405, 'DATABASE_METHOD_INVALID');
    return rpc(env, resourcePart.slice(4), init);
  }

  const table = resourcePart;
  ident(table);
  const params = new URLSearchParams(queryPart);

  if (method === 'GET' || method === 'HEAD') return selectRows(env, table, params);
  if (method === 'POST') return insertRows(env, table, params, init);
  if (method === 'PATCH') return patchRows(env, table, params, init);
  if (method === 'DELETE') return deleteRows(env, table, params, init);
  throw new HttpError(405, 'DATABASE_METHOD_INVALID');
}
