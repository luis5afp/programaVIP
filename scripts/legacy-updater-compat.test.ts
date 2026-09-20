import assert from 'node:assert/strict';
import { publicClientUpdateRoutes } from '../cloudflare/lib/client-updates.ts';

const originalFetch = globalThis.fetch;
const originalCaches = (globalThis as any).caches;

try {
  (globalThis as any).caches = undefined;

  const chunkBytes = new Uint8Array([1, 2, 3, 4]);
  const manifest = {
    version: '9.9.9',
    size: chunkBytes.byteLength,
    sha256: 'a'.repeat(64),
    chunks: [{ name: 'versions/9.9.9/part-000.bin', size: chunkBytes.byteLength }],
    publishedAt: new Date().toISOString(),
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

  let latestFetches = 0;
  globalThis.fetch = async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || input);
    if (url.endsWith('/latest.json')) {
      latestFetches += 1;
      if (latestFetches === 1) return new Response('temporary', { status: 502 });
      return new Response(manifestBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(manifestBytes.byteLength),
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const env = { SUPABASE_URL: 'https://example.supabase.co' };
  const request = new Request('https://admin.example/api/client-update/latest?ts=123');

  const first = await publicClientUpdateRoutes(request, env);
  assert.ok(first);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Userflex-Update-Source'), 'supabase');
  assert.deepEqual(await first.json(), manifest);
  assert.equal(latestFetches, 2, 'latest manifest should retry a transient upstream failure');

  const second = await publicClientUpdateRoutes(
    new Request('https://admin.example/api/client-update/latest?ts=456'),
    env,
  );
  assert.ok(second);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('X-Userflex-Update-Source'), 'memory-cache');
  assert.deepEqual(await second.json(), manifest);
  assert.equal(latestFetches, 2, 'legacy cache-busting query strings must still hit the normalized cache');

  let chunkFetches = 0;
  globalThis.fetch = async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url || input);
    if (url.endsWith('/versions/9.9.9/part-000.bin')) {
      chunkFetches += 1;
      if (chunkFetches === 1) return new Response('temporary', { status: 503 });
      return new Response(chunkBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunkBytes.byteLength),
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const chunk = await publicClientUpdateRoutes(
    new Request('https://admin.example/api/client-update/chunks/9.9.9/part-000.bin'),
    env,
  );
  assert.ok(chunk);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.headers.get('Content-Length'), String(chunkBytes.byteLength));
  assert.equal(chunk.headers.get('X-Userflex-Update-Source'), 'supabase-buffered');
  assert.deepEqual(new Uint8Array(await chunk.arrayBuffer()), chunkBytes);
  assert.equal(chunkFetches, 2, 'chunk delivery should retry before responding to a legacy client');

  console.log('Legacy updater compatibility route: OK');
} finally {
  globalThis.fetch = originalFetch;
  (globalThis as any).caches = originalCaches;
}
