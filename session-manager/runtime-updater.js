import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const RELEASE_API = 'https://api.github.com/repos/luis5afp/programaVIP/releases/tags/session-runtime-latest';
const MANIFEST_ASSET = 'userflex-session-runtime-manifest.json';
const REQUIRED_FILES = [
  'kaizen-capture-engine.js',
  'capture-state.js',
  'credential-policy.js',
  'proxy-relay.js',
];
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RUNTIME_FILE_BYTES = 8 * 1024 * 1024;

function semverParts(value) {
  return String(value || '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function versionAtLeast(current, minimum) {
  const left = semverParts(current);
  const right = semverParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function safeRuntimeVersion(value) {
  const version = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(version)) {
    throw new Error('El manifiesto del runtime tiene una versión inválida.');
  }
  return version;
}

function safeFileName(value) {
  const name = String(value || '').trim();
  if (!REQUIRED_FILES.includes(name)) {
    throw new Error(`Archivo de runtime no permitido: ${name || 'vacío'}.`);
  }
  return name;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fetchBuffer(url, timeoutMs = 20_000) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/octet-stream',
      'user-agent': 'userFLEX-Session-Manager',
    },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Descarga de runtime falló: HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 1 || buffer.byteLength > MAX_RUNTIME_FILE_BYTES) {
    throw new Error('Un archivo del runtime tiene un tamaño inválido.');
  }
  return buffer;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function verifyRuntimeDirectory(dir, manifest) {
  if (!manifest || safeRuntimeVersion(manifest.version) !== manifest.version) return false;
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length !== REQUIRED_FILES.length) return false;
  const names = new Set(files.map((item) => item?.name));
  if (!REQUIRED_FILES.every((name) => names.has(name))) return false;

  for (const item of files) {
    const name = safeFileName(item?.name);
    const expected = String(item?.sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) return false;
    const bytes = await fs.readFile(path.join(dir, name)).catch(() => null);
    if (!bytes || sha256(bytes) !== expected) return false;
  }
  return true;
}

async function installDependencyShims(runtimeDir) {
  const require = createRequire(import.meta.url);
  const puppeteerEntry = require.resolve('puppeteer-core');
  const socksEntry = require.resolve('socks');
  const puppeteerUrl = pathToFileURL(puppeteerEntry).href;
  const socksUrl = pathToFileURL(socksEntry).href;

  const puppeteerDir = path.join(runtimeDir, 'node_modules', 'puppeteer-core');
  const socksDir = path.join(runtimeDir, 'node_modules', 'socks');
  await fs.mkdir(puppeteerDir, { recursive: true });
  await fs.mkdir(socksDir, { recursive: true });

  await fs.writeFile(
    path.join(puppeteerDir, 'package.json'),
    JSON.stringify({ name: 'puppeteer-core', type: 'module', exports: './index.mjs' }),
    'utf8',
  );
  await fs.writeFile(
    path.join(puppeteerDir, 'index.mjs'),
    `import mod from ${JSON.stringify(puppeteerUrl)};\nexport default mod;\nexport * from ${JSON.stringify(puppeteerUrl)};\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(socksDir, 'package.json'),
    JSON.stringify({ name: 'socks', type: 'module', exports: './index.mjs' }),
    'utf8',
  );
  await fs.writeFile(
    path.join(socksDir, 'index.mjs'),
    `import mod from ${JSON.stringify(socksUrl)};\nexport default mod;\nexport const SocksClient = mod.SocksClient;\n`,
    'utf8',
  );
}

export function createRuntimeUpdater({ app, coreVersion, log = console } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('Runtime updater requiere Electron app.');
  const baseDir = path.join(app.getPath('userData'), 'session-runtime');
  const versionsDir = path.join(baseDir, 'versions');
  const statePath = path.join(baseDir, 'state.json');
  let inFlight = null;

  async function localRuntime(version) {
    if (!version) return null;
    const dir = path.join(versionsDir, version);
    const manifest = await readJson(path.join(dir, MANIFEST_ASSET));
    if (!manifest || !await verifyRuntimeDirectory(dir, manifest).catch(() => false)) return null;
    await installDependencyShims(dir).catch(() => null);
    return {
      version,
      moduleUrl: pathToFileURL(path.join(dir, 'kaizen-capture-engine.js')).href,
      source: 'cache',
    };
  }

  async function cachedRuntime() {
    const state = await readJson(statePath);
    for (const version of [state?.current, state?.previous]) {
      const runtime = await localRuntime(version);
      if (runtime) return runtime;
    }
    return null;
  }

  async function cleanupVersions(keep) {
    const allowed = new Set(keep.filter(Boolean));
    const entries = await fs.readdir(versionsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !allowed.has(entry.name))
      .map((entry) => fs.rm(path.join(versionsDir, entry.name), { recursive: true, force: true }).catch(() => null)));
  }

  async function downloadLatest() {
    const releaseResponse = await fetch(RELEASE_API, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'userFLEX-Session-Manager',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!releaseResponse.ok) throw new Error(`No se pudo consultar el runtime: HTTP ${releaseResponse.status}.`);
    const release = await releaseResponse.json();
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const byName = new Map(assets.map((asset) => [String(asset?.name || ''), asset]));
    const manifestAsset = byName.get(MANIFEST_ASSET);
    if (!manifestAsset?.browser_download_url) throw new Error('La release del runtime no tiene manifiesto.');

    const manifestBytes = await fetchBuffer(manifestAsset.browser_download_url);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const version = safeRuntimeVersion(manifest.version);
    const minimumCoreVersion = String(manifest.minCoreVersion || '0.0.0');
    if (!versionAtLeast(coreVersion, minimumCoreVersion)) {
      throw new Error(
        `El runtime ${version.slice(0, 8)} requiere Session Manager ${minimumCoreVersion} o superior.`,
      );
    }

    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (files.length !== REQUIRED_FILES.length) throw new Error('El manifiesto del runtime está incompleto.');
    const names = new Set(files.map((item) => safeFileName(item?.name)));
    if (!REQUIRED_FILES.every((name) => names.has(name))) throw new Error('Faltan archivos requeridos del runtime.');

    const existing = await localRuntime(version);
    if (existing) return { ...existing, source: 'latest' };

    await fs.mkdir(versionsDir, { recursive: true });
    const tempDir = path.join(versionsDir, `.${version}.tmp-${process.pid}-${Date.now()}`);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      for (const item of files) {
        const name = safeFileName(item.name);
        const asset = byName.get(name);
        if (!asset?.browser_download_url) throw new Error(`Falta el asset ${name}.`);
        const bytes = await fetchBuffer(asset.browser_download_url);
        const expected = String(item.sha256 || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(expected) || sha256(bytes) !== expected) {
          throw new Error(`SHA-256 inválido para ${name}.`);
        }
        if (Number(item.size || bytes.byteLength) !== bytes.byteLength) {
          throw new Error(`Tamaño inesperado para ${name}.`);
        }
        await fs.writeFile(path.join(tempDir, name), bytes);
      }
      await writeJson(path.join(tempDir, MANIFEST_ASSET), manifest);
      await installDependencyShims(tempDir);
      if (!await verifyRuntimeDirectory(tempDir, manifest)) throw new Error('El runtime descargado no pasó verificación local.');

      const finalDir = path.join(versionsDir, version);
      await fs.rm(finalDir, { recursive: true, force: true }).catch(() => null);
      await fs.rename(tempDir, finalDir);

      const previousState = await readJson(statePath);
      const previous = previousState?.current && previousState.current !== version
        ? previousState.current
        : previousState?.previous || null;
      await writeJson(statePath, {
        current: version,
        previous,
        checkedAt: new Date().toISOString(),
      });
      await cleanupVersions([version, previous]);

      return {
        version,
        moduleUrl: pathToFileURL(path.join(finalDir, 'kaizen-capture-engine.js')).href,
        source: 'latest',
      };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
      throw error;
    }
  }

  async function ensureLatestRuntime({ force = false } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const state = await readJson(statePath);
      const checkedAt = Date.parse(state?.checkedAt || '') || 0;
      if (!force && checkedAt && Date.now() - checkedAt < CHECK_INTERVAL_MS) {
        const cached = await cachedRuntime();
        if (cached) return cached;
      }

      try {
        const runtime = await downloadLatest();
        const nextState = await readJson(statePath);
        await writeJson(statePath, {
          current: runtime.version,
          previous: nextState?.previous || null,
          checkedAt: new Date().toISOString(),
        });
        return runtime;
      } catch (error) {
        log.warn?.(`Session Manager runtime update skipped: ${error instanceof Error ? error.message : String(error)}`);
        const cached = await cachedRuntime();
        if (cached) return cached;
        return null;
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    ensureLatestRuntime,
    cachedRuntime,
  };
}
