import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
assert.equal(process.platform,'win32');
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const electron=path.join(root,'smoke-electron','node_modules','electron','dist','electron.exe');
await access(electron);
const temp=await mkdtemp(path.join(tmpdir(),'userflow-native-test-'));
const appDir=path.join(temp,'app'),data=path.join(temp,'data');
await mkdir(appDir);await mkdir(data);
const code=`
const {app,session}=require('electron');
const assert=require('node:assert/strict');
app.setPath('userData',process.env.LAB_DATA);
app.whenReady().then(async()=>{
 const a=session.fromPartition('fixture-a'),b=session.fromPartition('fixture-b');
 const url='https://example.test/';
 await a.cookies.set({url,name:'local_fixture',value:'test-only',httpOnly:true,secure:true});
 assert.equal((await a.cookies.get({url,name:'local_fixture'})).length,1);
 assert.equal((await b.cookies.get({url,name:'local_fixture'})).length,0);
 await a.clearStorageData({storages:['cookies']});
 assert.equal((await a.cookies.get({url,name:'local_fixture'})).length,0);
 await a.setProxy({mode:'fixed_servers',proxyRules:'http://127.0.0.1:34567',proxyBypassRules:'<-loopback>'});
 await a.closeAllConnections();
 assert.equal(await a.resolveProxy(url),'PROXY 127.0.0.1:34567');
 await b.setProxy({mode:'direct'});
 assert.equal(await b.resolveProxy(url),'DIRECT');
 console.log('INTEGRATED_NATIVE_SESSION_OK');app.exit(0);
}).catch(e=>{console.error(e.message);app.exit(1);});
`;
try{
 await writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'integrated-native-test',version:'1.0.0',main:'main.cjs'}));
 await writeFile(path.join(appDir,'main.cjs'),code);
 const result=await new Promise((resolve,reject)=>{
  const p=spawn(electron,[appDir,'--disable-gpu'],{windowsHide:true,env:{...process.env,LAB_DATA:data},stdio:['ignore','pipe','pipe']});
  let out='',err='';p.stdout.on('data',d=>out+=String(d));p.stderr.on('data',d=>err+=String(d));
  const timer=setTimeout(()=>{p.kill();reject(Error('Native Electron test timed out'));},30000);
  p.once('error',e=>{clearTimeout(timer);reject(e);});
  p.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});
 });
 assert.equal(result.code,0,result.err);assert.match(result.out,/INTEGRATED_NATIVE_SESSION_OK/);
 console.log('Native Electron fixture cookie isolation, cleanup and proxy routing: OK');
}finally{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}
