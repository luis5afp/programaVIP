import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'Smoke test must run in a Windows runner');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const electron = process.env.USERFLOW_TEST_ELECTRON_BIN || path.join(root, 'smoke-electron', 'node_modules', 'electron', 'dist', 'electron.exe');
await access(electron);
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'userflow-secure-login-'));
const appDir = path.join(fixtureDir, 'app');
const userData = path.join(fixtureDir, 'userData-login');
const otherUserData = path.join(fixtureDir, 'userData-reopen');
const appData = path.join(fixtureDir, 'appData');
await mkdir(appDir, { recursive:true });
await mkdir(userData, { recursive:true });
await mkdir(otherUserData, { recursive:true });
await mkdir(appData, { recursive:true });
const modulePath = path.join(root, 'client-app', 'auth-session-cache.js');
const locationModule = path.join(root, 'client-app', 'auth-session-locations.js');
const testMain = [
  "const { app, safeStorage } = require('electron');",
  "const { pathToFileURL } = require('node:url');",
  "app.setPath('userData', process.env.USERFLOW_AUTH_TEST_USER_DATA);",
  "app.whenReady().then(async () => {",
  "  const { saveEncryptedAuthSession, readEncryptedAuthSession } = await import(pathToFileURL(process.env.USERFLOW_AUTH_TEST_MODULE).href);",
  "  const { canonicalAuthFile } = await import(pathToFileURL(process.env.USERFLOW_AUTH_TEST_LOCATIONS).href);",
  "  const cacheFile = canonicalAuthFile(process.env.USERFLOW_AUTH_TEST_APP_DATA);",
  "  const token = 'AUTH_TEST_ONLY_A'.repeat(4);",
  "  if (process.env.USERFLOW_AUTH_TEST_PHASE === 'save') {",
  "    const createdAt = new Date().toISOString();",
  "    const meta = { createdAt, expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString() };",
  "    await saveEncryptedAuthSession(cacheFile, token, meta, safeStorage);",
  "    process.stdout.write('USERFLOW_AUTH_SMOKE_SAVED\\n');",
  "  } else {",
  "    const result = await readEncryptedAuthSession(cacheFile, safeStorage);",
  "    if (result.ok !== true || result.token !== token || result.legacyCreatedAt || result.legacyExpiry) {",
  "      throw new Error('Cannot reopen secure session: ' + String(result.reason || 'invalid token'));",
  "    }",
  "    process.stdout.write('USERFLOW_AUTH_SMOKE_REOPENED\\n');",
  "  }",
  "  app.quit();",
  "}).catch(error => {",
  "  process.stderr.write(String(error?.code || error?.message || error) + '\\n');",
  "  app.exit(2);",
  "});",
].join('\n');
await writeFile(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'userflow-auth-smoke', version:'1.0.0', main:'main.cjs'
}));
await writeFile(path.join(appDir, 'main.cjs'), testMain);

async function run(phase, marker) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(electron,[appDir, '--disable-gpu'],{
      windowsHide:true,
      stdio:['ignore','pipe','pipe'],
      env: {
        ...process.env,
        USERFLOW_AUTH_TEST_USER_DATA: phase === 'save' ? userData : otherUserData,
        USERFLOW_AUTH_TEST_APP_DATA:appData,
        USERFLOW_AUTH_TEST_LOCATIONS:locationModule,
        USERFLOW_AUTH_TEST_MODULE:modulePath,
        USERFLOW_AUTH_TEST_PHASE:phase,
      },
    });
    let out='', err='';
    proc.stdout.on('data',data=>{out+=String(data).slice(0,2000);});
    proc.stderr.on('data',data=>{err+=String(data).slice(0,2000);});
    const timer=setTimeout(()=>{proc.kill();reject(new Error('Electron Windows smoke timeout: '+phase));},30_000);
    proc.once('error',error=>{clearTimeout(timer);reject(error);});
    proc.once('exit',code=>{clearTimeout(timer);resolve({code,out,err});});
  });
  assert.equal(result.code,0,'Electron '+phase+' failed: '+result.err.slice(-900));
  assert.ok(result.out.includes(marker),'Expected '+marker+' not seen: '+result.out);
}
try {
  await run('save','USERFLOW_AUTH_SMOKE_SAVED');
  // A new Electron process with DIFFERENT userData retrieves the same
  // token because its canonical Windows account location does not change.
  await run('load','USERFLOW_AUTH_SMOKE_REOPENED');
  console.log('userFLOW Windows DPAPI/electron safeStorage: persisted across closing and reopening: OK');
} finally {
  await rm(fixtureDir,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
