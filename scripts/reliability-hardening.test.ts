import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminApi = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const adminMain = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../src/components/ErrorBoundary.tsx', import.meta.url), 'utf8');
const core = readFileSync(new URL('../cloudflare/lib/core.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../client-app/main.js', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../session-manager/main.js', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8');

assert.match(adminApi, /REQUEST_TIMEOUT_MS = 20_000/);
assert.match(adminApi, /method === 'GET' \|\| method === 'HEAD'/);
assert.match(adminApi, /RETRYABLE_HTTP_STATUS/);
assert.match(adminApi, /X-Userflex-Request-Id/);
assert.match(adminMain, /<ErrorBoundary>/);
assert.match(boundary, /Recargar panel/);

assert.match(core, /NEON_DATABASE_URL/);
assert.match(core, /Neon database error/);
assert.match(core, /DATABASE_UNAVAILABLE/);
assert.match(worker, /X-Userflex-Request-Id/);
assert.match(worker, /requestId/);

assert.match(client, /TRANSIENT_HTTP_STATUS/);
assert.match(client, /const retryable = method === 'GET' \|\| method === 'HEAD'/);
assert.match(client, /uncaughtExceptionMonitor/);
assert.match(client, /render-process-gone/);
assert.match(client, /requestId: error\?\.requestId \|\| null/);

assert.match(manager, /X-Userflex-Request-Id/);
assert.match(manager, /REQUEST_TIMEOUT/);
assert.match(manager, /uncaughtExceptionMonitor/);
assert.match(manager, /Solicitud:/);

assert.match(deploy, /for attempt in \$\(seq 1 30\)/);
assert.match(deploy, /Waiting for Cloudflare propagation/);
assert.match(deploy, /--retry 3 --retry-all-errors/);

const rendererSource = readFileSync(new URL('../client-app/renderer.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../client-app/index.html', import.meta.url), 'utf8');
assert.match(rendererSource, /setStreamingNotice/);
assert.match(rendererSource, /STREAMING DOM:/);
assert.match(rendererSource, /Browser Guard/);
assert.match(rendererSource, /Detectados:/);
assert.match(rendererSource, /Ocultados:/);
assert.match(rendererSource, /Scripts dentro de la página:/);
assert.match(rendererSource, /Extensiones administradas:/);
assert.match(rendererSource, /Autofill:/);
assert.match(indexSource, /id="streaming-notice"/);

console.log('Cross-component reliability hardening: OK');
