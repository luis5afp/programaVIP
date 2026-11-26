import {createHash} from 'node:crypto';
// Integrated Chromium is selected automatically by the server for authorized manual
// access without managed sessions, credentials, mandatory extensions or content rules.
// Native proxy support is deliberately limited to validated, unauthenticated proxies.
export function nativeProxyConfig(connection) {
  if (connection?.mode === 'direct' && connection.locked === false && !connection.proxy) return {mode:'direct'};
  const p=connection?.proxy;
  if (connection?.mode !== 'proxy' || connection.locked !== false || !p
      || !['http','socks5'].includes(p.type) || p.validationStatus !== 'valid'
      || !/^[a-z0-9.-]+$/i.test(String(p.host || ''))
      || !Number.isInteger(Number(p.port)) || Number(p.port)<1 || Number(p.port)>65535
      || p.username || p.password) return null;
  return {mode:'fixed_servers',proxyRules:p.type+'://'+p.host+':'+Number(p.port),proxyBypassRules:'<-loopback>'};
}

export function integratedManualEligible(launch) {
  if (launch?.profile?.launchEngine !== 'electron-integrated-manual' || !launch?.client) return false;
  const {profile,client,connection,sessionDelivery,credentialDelivery}=launch;
  let url;
  try {url=new URL(profile.url);} catch {return false;}
  return url.protocol==='https:' && !url.username && !url.password
    && profile.runtime?.browserEngine==='chrome-native'
    && profile.runtime?.authStrategy==='manual'
    && profile.runtime?.extensionStrategy==='guard-only'
    && profile.runtime?.storageStrategy==='local-persistent'
    && profile.runtime?.deviceLocalAuth!==true
    && client.allowExternalBrowsing===true && client.browserExtensionsAccess==='full'
    && nativeProxyConfig(connection)!==null
    && sessionDelivery?.materialIncluded===false && !sessionDelivery.material
    && !credentialDelivery
    && Array.isArray(profile.extensions) && profile.extensions.length===0
    && Array.isArray(profile.contentRules) && profile.contentRules.length===0;
}

export function isIntegratedManualNavigation(url, origin) {
  try {
    const target=new URL(url);
    return target.protocol==='https:' && target.origin===origin && !target.username && !target.password;
  } catch {return false;}
}

// Stable only inside the current authorized local account and login epoch.
export function integratedLocalPartition(launch, scope) {
  const profile=launch?.profile;
  const values=[scope?.clientId,scope?.loginEpoch,scope?.configRevision,profile?.id];
  if(values.some(v=>typeof v!=='string'||!v.trim()))throw new Error('Identidad local autorizada incompleta.');
  const origin=new URL(profile.url).origin;
  return 'persist:userflow-manual-v1-'+createHash('sha256').update(JSON.stringify([...values,origin])).digest('hex');
}

export function createIntegratedManualController({BrowserWindow, session, onClosed}) {
  const active=new Map();
  const downloads=new WeakSet();
  const localSessions=new Map();
  const pendingCleanup=new Map();
  function cleanup(name, isolated, erase) {
    const prior=pendingCleanup.get(name)||Promise.resolve();
    const task=prior.catch(()=>{}).then(async()=>{
      await isolated.closeAllConnections();
      if(erase){await isolated.clearStorageData();await isolated.clearCache();}
      else {isolated.flushStorageData();await isolated.cookies.flushStore();}
    });
    pendingCleanup.set(name,task);
    void task.finally(()=>{if(pendingCleanup.get(name)===task)pendingCleanup.delete(name);}).catch(()=>{});
    return task;
  }
  function closeAll(reason) {
    const erase=reason==='logout'||reason==='configuration_changed';
    for(const entry of [...active.values()]){
      entry.reason=reason;
      if(!entry.window.isDestroyed())entry.window.destroy();
    }
    if(erase){
      for(const [name,isolated] of localSessions)void cleanup(name,isolated,true).catch(()=>{});
      localSessions.clear();
    }
    return Promise.allSettled([...pendingCleanup.values()]);
  }
  async function open(launch, usage, scope) {
    if (!integratedManualEligible(launch)) throw new Error('Perfil no autorizado para navegador integrado.');
    const {profile}=launch;
    const name=integratedLocalPartition(launch,scope);
    const existing=active.get(name);
    if(existing&&!existing.window.isDestroyed()){
      if(usage?.usageId&&usage.usageId!==existing.usage?.usageId)void Promise.resolve(onClosed(usage,'duplicate_open')).catch(()=>{});
      const result=await existing.ready;
      if(!existing.window.isDestroyed()){existing.window.show();existing.window.focus();}
      return result;
    }
    // No await before reserving the window; concurrent opens reuse it.
    const origin=new URL(profile.url).origin;
    const isolated=session.fromPartition(name);
    localSessions.set(name,isolated);
    isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    isolated.setPermissionCheckHandler(()=>false);
    if(!downloads.has(isolated)){isolated.on('will-download',event=>event.preventDefault());downloads.add(isolated);}
    isolated.webRequest.onBeforeRequest((details,callback)=>{
      callback({cancel:details.resourceType==='mainFrame'&&!isIntegratedManualNavigation(details.url,origin)});
    });
    const window=new BrowserWindow({title:'userFLOW · '+profile.name,width:1200,height:850,show:false,autoHideMenuBar:true,backgroundColor:'#09090b',webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:false,webviewTag:false}});
    const entry={window,usage,reason:'browser_exit',ready:null};
    active.set(name,entry);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const eventName of ['will-navigate','will-redirect']){
      window.webContents.on(eventName,(event,url)=>{if(!isIntegratedManualNavigation(url,origin))event.preventDefault();});
    }
    window.on('closed',()=>{
      if(active.get(name)===entry)active.delete(name);
      void Promise.resolve(onClosed(usage,entry.reason)).catch(()=>null);
      void cleanup(name,isolated,false).catch(()=>null);
    });
    entry.ready=(async()=>{
      try{
        // Never retry a failed proxy setup directly.
        await pendingCleanup.get(name);
        if(window.isDestroyed()||active.get(name)!==entry)throw new Error('La apertura fue cancelada.');
        await isolated.setProxy(nativeProxyConfig(launch.connection));
        await isolated.closeAllConnections();
        if(window.isDestroyed()||active.get(name)!==entry)throw new Error('La apertura fue cancelada.');
        await window.loadURL(profile.url);
        if(window.isDestroyed()||active.get(name)!==entry)throw new Error('La apertura fue cancelada.');
        window.show();
        return {ok:true,external:false,tabbed:false,engine:'electron-integrated-manual',sessionVersion:0,profileState:'manual-login'};
      }catch(error){entry.reason='launch_failed';if(!window.isDestroyed())window.destroy();throw error;}
    })();
    return entry.ready;
  }
  return {open,closeAll};
}
