const {app,BrowserWindow,session} = require('electron');
const {mkdtempSync,mkdirSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createFixture,healthCheck} = require('./fixture.cjs');
const smoke=process.argv.includes('--smoke');
const dataDir=smoke?mkdtempSync(path.join(tmpdir(),'userflow-lab-')):path.join(app.getPath('appData'),'userFLOW-LAB');
mkdirSync(dataDir,{recursive:true});
app.setPath('userData',dataDir);
app.setName('userFLOW LAB');
let fixture;
function makeWindow(partition){
  const isolated=session.fromPartition(partition);
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.webRequest.onBeforeRequest((details,callback)=>{
    let allowed=false;
    try{allowed=new URL(details.url).origin===fixture.origin;}catch{}
    callback({cancel:!allowed});
  });
  const win=new BrowserWindow({width:900,height:700,show:!smoke,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{try{if(new URL(url).origin!==fixture.origin)e.preventDefault();}catch{e.preventDefault();}});
  return win;
}
async function waitState(win,expected){
  for(let n=0;n<100;n++){
    if(!win.webContents.isLoading()){
      const state=await win.webContents.executeJavaScript("document.getElementById('state')?.textContent").catch(()=>null);
      if(state===expected)return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Fixture state did not become '+expected);
}
async function runSmoke(){
  const a=makeWindow('persist:lab-a'),b=makeWindow('persist:lab-b');
  await Promise.all([a.loadURL(fixture.origin),b.loadURL(fixture.origin)]);
  await waitState(a,'Sin sesión de demostración');await waitState(b,'Sin sesión de demostración');
  await a.webContents.executeJavaScript("document.getElementById('action').click(); undefined");
  await waitState(a,'Sesión de demostración activa');
  await a.loadURL(fixture.origin);await waitState(a,'Sesión de demostración activa');
  await b.loadURL(fixture.origin);await waitState(b,'Sin sesión de demostración');
  assert.equal(a.webContents.session===b.webContents.session,false);
  await a.webContents.executeJavaScript("document.getElementById('action').click(); undefined");
  await waitState(a,'Sin sesión de demostración');
  console.log('LAB_SMOKE_OK: login ficticio, recarga, aislamiento y logout');
}
app.whenReady().then(async()=>{
  fixture=await createFixture({health:smoke?'Modo de prueba local':await healthCheck()});
  if(smoke){await runSmoke();app.exit(0);}
  else {const win=makeWindow('persist:lab-demo');await win.loadURL(fixture.origin);}
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{void fixture?.close();});
process.on('exit',()=>{if(smoke)try{rmSync(dataDir,{recursive:true,force:true});}catch{}});
