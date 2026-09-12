import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const UPDATE_BASE_URL = 'https://lbvxnbbglkjnwphaomyx.supabase.co/storage/v1/object/public/userflex-client-releases';
const UPDATE_MANIFEST_URL = `${UPDATE_BASE_URL}/latest.json`;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const MAX_UPDATE_BYTES = 300 * 1024 * 1024;

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0).slice(0, 4);
}

function isNewerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

function validateManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('UPDATE_MANIFEST_INVALID');
  const version = String(value.version || '').trim();
  const sha256 = String(value.sha256 || '').trim().toLowerCase();
  const size = Number(value.size || 0);
  const chunks = Array.isArray(value.chunks) ? value.chunks : [];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('UPDATE_VERSION_INVALID');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('UPDATE_HASH_INVALID');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPDATE_BYTES) throw new Error('UPDATE_SIZE_INVALID');
  if (chunks.length < 1 || chunks.length > 64) throw new Error('UPDATE_CHUNKS_INVALID');
  let total = 0;
  const normalized = chunks.map((chunk, index) => {
    const name = String(chunk?.name || '').trim();
    const chunkSize = Number(chunk?.size || 0);
    if (!name.startsWith(`versions/${version}/`) || !/^versions\/[0-9A-Za-z.-]+\/part-\d{3}\.bin$/.test(name)) throw new Error(`UPDATE_CHUNK_NAME_INVALID_${index}`);
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 25 * 1024 * 1024) throw new Error(`UPDATE_CHUNK_SIZE_INVALID_${index}`);
    total += chunkSize;
    return { name, size: chunkSize };
  });
  if (total !== size) throw new Error('UPDATE_TOTAL_SIZE_MISMATCH');
  return { version, sha256, size, chunks: normalized };
}

async function fetchManifest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?ts=${Date.now()}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`UPDATE_MANIFEST_HTTP_${response.status}`);
    return validateManifest(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

async function downloadInstaller(manifest, onProgress) {
  const updateDir = path.join(app.getPath('userData'), 'updates');
  await fs.rm(updateDir, { recursive: true, force: true });
  await fs.mkdir(updateDir, { recursive: true });
  const installerPath = path.join(updateDir, `userFLOW-${manifest.version}-Setup.exe`);
  const file = await fs.open(installerPath, 'w');
  const hash = crypto.createHash('sha256');
  let totalReceived = 0;
  try {
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      const chunk = manifest.chunks[index];
      const response = await fetch(`${UPDATE_BASE_URL}/${chunk.name}?v=${encodeURIComponent(manifest.version)}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok || !response.body) throw new Error(`UPDATE_CHUNK_HTTP_${response.status}`);
      const reader = response.body.getReader();
      let chunkReceived = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const buffer = Buffer.from(value);
        await file.write(buffer);
        hash.update(buffer);
        totalReceived += buffer.length;
        chunkReceived += buffer.length;
        onProgress?.(Math.min(99, (totalReceived / manifest.size) * 100));
      }
      if (chunkReceived !== chunk.size) throw new Error(`UPDATE_CHUNK_LENGTH_MISMATCH_${index}`);
    }
    await file.sync();
  } finally {
    await file.close();
  }
  if (totalReceived !== manifest.size || hash.digest('hex') !== manifest.sha256) {
    await fs.rm(installerPath, { force: true });
    throw new Error('UPDATE_FILE_VERIFY_FAILED');
  }
  return installerPath;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function installAndRestart(installerPath) {
  const currentExe = app.getPath('exe');
  const command = [
    `$targetPid=${process.pid}`,
    'Wait-Process -Id $targetPid -ErrorAction SilentlyContinue',
    `$installer=${psQuote(installerPath)}`,
    `$appExe=${psQuote(currentExe)}`,
    "$install=Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru",
    'if ($install.ExitCode -eq 0 -and (Test-Path $appExe)) { Start-Process -FilePath $appExe }',
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  app.quit();
}

export async function checkForRequiredUpdate({ onStatus } = {}) {
  onStatus?.({ phase: 'checking', message: 'Verificando actualización…', percent: null });
  if (!app.isPackaged) return { updateRequired: false };
  const manifest = await fetchManifest();
  if (!isNewerVersion(manifest.version, app.getVersion())) {
    onStatus?.({ phase: 'ready', message: `v${app.getVersion()} · Actualizado`, percent: null });
    return { updateRequired: false };
  }
  onStatus?.({ phase: 'downloading', message: `Actualizando a v${manifest.version}…`, percent: 0 });
  const installerPath = await downloadInstaller(manifest, (percent) => onStatus?.({ phase: 'downloading', message: `Actualizando a v${manifest.version}…`, percent }));
  onStatus?.({ phase: 'installing', message: `Actualización v${manifest.version} verificada · instalando…`, percent: 100 });
  setTimeout(() => installAndRestart(installerPath), 500);
  return { updateRequired: true };
}
