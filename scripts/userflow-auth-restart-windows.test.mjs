import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'Smoke test must run in a Windows runner');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const electron = path.join(root, 'client-app', 'node_modules', 'electron', 'dist', 'electron.exe');
await access(electron);
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'userflow-secure-login-'));
const appDir = path.join(fixtureDir, 'app');
const userData = path.join(fixtureDir, 'userData');
await mkdir(appDir, { recursive:true });
await mkdir(userData, { recursive:true });
const cacheFile = path.join(userData,'auth.json');
const modulePath = path.join(root, 'client-app', 'auth-session-cache.js');
const testMain = [
  "const { app, safeStorage } = require('electron');",
  "const { pathToFileURL } = require('node:url');",
  "app.setPath('userData', process.env.USERFLOW_AUTH_TEST_USER_DATA);",
  "app.whenReady().then(async () => {",
  "  const { saveEncryptedAuthSession, readEncryptedAuthSession } = await import(pathToFileURL(process.env.USERFLOW_AUTH_TEST_MODULE).href);",
  "  const token = 'AUTH_TEST_ONLY_A'.repeat(4);",
  "  if (process.env.USERFLOW_AUTH_TEST_PHASE === 'save') {",
  "    const meta = { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };",
  "    await saveEncryptedAuthSession(process.env.USERFLOW_AUTH_TEST_FILE, token, meta, safeStorage);",
  "    process.stdout.write('USERFLOW_AUTH_SMOKE_SAVED\\n');",
  "  } else {",
  "    const result = await readEncryptedAuthSession(process.env.USERFLOW_AUTH_TEST_FILE, safeStorage);",
  "    if (result.ok !== true || result.token !== token || result.legacyExpiry) {",
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
        USERFLOW_AUTH_TEST_USER_DATA:userData,
        USERFLOW_AUTH_TEST_MODULE:modulePath,
        USERFLOW_AUTH_TEST_FILE:cacheFile,
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
  // A fresh native Electron process reads the existing Windows-encrypted file.
  await run('load','USERFLOW_AUTH_SMOKE_REOPENED');
  console.log('userFLOW Windows DPAPI/electron safeStorage: persisted across closing and reopening: OK');
} finally {
  await rm(fixtureDir,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
