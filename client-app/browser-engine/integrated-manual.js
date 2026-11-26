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

export function createIntegratedManualController({BrowserWindow, session, randomUUID, onClosed}) {
  const active=new Map();
  function close(profileId, reason) {
    const entry=active.get(profileId);
    if (!entry) return;
    entry.reason=reason;
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  function closeAll(reason) {for(const id of [...active.keys()])close(id,reason);}
  async function open(launch, usage) {
    if (!integratedManualEligible(launch)) throw new Error('Perfil no autorizado para navegador integrado.');
    const {profile}=launch;
    close(profile.id,'profile_reopened');
    const origin=new URL(profile.url).origin;
    const isolated=session.fromPartition('userflow-manual-'+randomUUID());
    isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    isolated.setPermissionCheckHandler(()=>false);
    isolated.on('will-download',event=>event.preventDefault());
    isolated.webRequest.onBeforeRequest((details,callback)=>{
      const mainFrame=details.resourceType==='mainFrame';
      callback({cancel:mainFrame&&!isIntegratedManualNavigation(details.url,origin)});
    });
    const window=new BrowserWindow({title:'userFLOW · '+profile.name,width:1200,height:850,show:false,autoHideMenuBar:true,backgroundColor:'#09090b',webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:false,webviewTag:false}});
    const entry={window,usage,reason:'browser_exit'};
    active.set(profile.id,entry);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const eventName of ['will-navigate','will-redirect']){
      window.webContents.on(eventName,(event,url)=>{if(!isIntegratedManualNavigation(url,origin))event.preventDefault();});
    }
    window.on('closed',()=>{
      if(active.get(profile.id)===entry)active.delete(profile.id);
      void Promise.resolve(onClosed(usage,entry.reason)).catch(()=>null);
      void isolated.closeAllConnections().catch(()=>null);
      void isolated.clearStorageData().catch(()=>null);
      void isolated.clearCache().catch(()=>null);
    });
    try {
      // Configure before navigation; a failed proxy configuration is never
      // retried via a direct connection.
      const config=nativeProxyConfig(launch.connection);
      await isolated.setProxy(config);
      await isolated.closeAllConnections();
      if(window.isDestroyed()||active.get(profile.id)!==entry)throw new Error('La apertura fue cancelada.');
      await window.loadURL(profile.url);
      if(window.isDestroyed()||active.get(profile.id)!==entry)throw new Error('La apertura fue cancelada.');
      window.show();
      return {ok:true,external:false,tabbed:false,engine:'electron-integrated-manual',sessionVersion:0,profileState:'manual-login'};
    }catch(error){entry.reason='launch_failed';if(!window.isDestroyed())window.destroy();throw error;}
  }
  return {open,closeAll};
}
