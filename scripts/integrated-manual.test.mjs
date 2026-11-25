import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {integratedManualEligible,isIntegratedManualNavigation,createIntegratedManualController,nativeProxyConfig} from '../client-app/browser-engine/integrated-manual.js';
import {EventEmitter} from 'node:events';
const fixture={profile:{id:'test',name:'Manual',url:'https://example.test/',launchEngine:'electron-integrated-manual',runtime:{browserEngine:'chrome-native',authStrategy:'manual',extensionStrategy:'guard-only',storageStrategy:'local-persistent'},extensions:[],contentRules:[]},client:{allowExternalBrowsing:true,browserExtensionsAccess:'full'},connection:{mode:'direct',locked:false},sessionDelivery:{materialIncluded:false},credentialDelivery:null};
assert.equal(integratedManualEligible(fixture),true);
assert.equal(integratedManualEligible({...fixture,profile:{...fixture.profile,launchEngine:undefined}}),false);
for(const mutate of [
  x=>x.profile.launchEngine='kaizen-external',
  x=>x.profile.runtime.browserEngine='nstchrome',
  x=>x.profile.runtime.authStrategy='cookie-snapshot',
  x=>x.profile.runtime.authStrategy='hybrid',
  x=>x.profile.runtime.deviceLocalAuth=true,
  x=>x.profile.runtime.extensionStrategy='custom',
  x=>x.profile.extensions=[{id:'required'}],
  x=>x.profile.contentRules=[{id:'required'}],
  x=>x.client.browserExtensionsAccess='restricted',
  x=>x.client.allowExternalBrowsing=false,
  x=>x.connection.mode='proxy',
  x=>x.connection.locked=true,
  x=>x.sessionDelivery.materialIncluded=true,
  x=>x.credentialDelivery={included:true},
  x=>x.profile.url='http://example.test/',
]){const x=structuredClone(fixture);mutate(x);assert.equal(integratedManualEligible(x),false);}
assert.equal(isIntegratedManualNavigation('https://example.test/path','https://example.test'),true);
for(const url of ['https://elsewhere.test','https://user:pass@example.test/','http://example.test','file:///tmp/test','javascript:alert(1)'])assert.equal(isIntegratedManualNavigation(url,'https://example.test'),false);
const proxy={mode:'proxy',locked:false,proxy:{host:'proxy.example.test',port:8080,type:'http',validationStatus:'valid'}};
assert.deepEqual(nativeProxyConfig(proxy),{mode:'fixed_servers',proxyRules:'http://proxy.example.test:8080',proxyBypassRules:'<-loopback>'});
assert.equal(integratedManualEligible({...fixture,connection:proxy}),true);
for(const changes of [{username:'user'},{password:'secret'},{type:'socks4'},{validationStatus:'invalid'},{host:'example.test;DIRECT'},{port:0}])assert.equal(nativeProxyConfig({...proxy,proxy:{...proxy.proxy,...changes}}),null);
assert.equal(nativeProxyConfig({...proxy,locked:true}),null);
let created=[],cleared=[],closed=[],options,proxyCalls=[],failProxy=false;
class Win extends EventEmitter{
 constructor(opts){super();options=opts;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>{this.popup=fn;};created.push(this);}
 setMenu(){} isDestroyed(){return !!this.destroyed;} destroy(){this.destroyed=true;this.emit('closed');} async loadURL(){this.loaded=true;} show(){this.shown=true;}
}
const controller=createIntegratedManualController({BrowserWindow:Win,session:{fromPartition(name){return {name,setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){}},setProxy:async config=>{proxyCalls.push(config);if(failProxy)throw Error('proxy configuration failed');},closeAllConnections:async()=>{},clearStorageData:async()=>cleared.push(name),clearCache:async()=>{}};}},randomUUID:()=>String(created.length+1),onClosed:(usage,reason)=>closed.push([usage,reason])});
await assert.rejects(controller.open({...fixture,profile:{...fixture.profile,launchEngine:'kaizen-external'}},{}));
const result=await controller.open(fixture,{usageId:'one'});
assert.equal(result.engine,'electron-integrated-manual');
assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.nodeIntegration,false);assert.equal(options.webPreferences.contextIsolation,true);assert.equal(options.webPreferences.devTools,false);
assert.equal(options.webPreferences.session.name.startsWith('persist:'),false);
assert.deepEqual(created[0].popup(),{action:'deny'});
let prevented=false;created[0].webContents.emit('will-redirect',{preventDefault(){prevented=true;}},'https://other.test');assert.equal(prevented,true);
controller.closeAll('logout');assert.equal(created[0].destroyed,true);assert.deepEqual(closed,[[{usageId:'one'},'logout']]);assert.equal(cleared.length,1);
assert.deepEqual(proxyCalls[0],{mode:'direct'});
await controller.open({...fixture,connection:proxy},{usageId:'two'});
assert.deepEqual(proxyCalls[1],nativeProxyConfig(proxy));
controller.closeAll('logout');
failProxy=true;
await assert.rejects(controller.open({...fixture,connection:proxy},{usageId:'three'}),/proxy configuration failed/);
assert.equal(created[2].loaded,undefined);
assert.equal(created[2].destroyed,true);
const main=readFileSync(new URL('../client-app/main.js',import.meta.url),'utf8');
assert.doesNotMatch(main,/--integrated-manual/);
assert.match(main,/if \(integratedManualEligible\(launch\)\)/);
assert.match(main,/integratedManual.closeAll\('logout'\)/);
assert.match(main,/integratedManual.closeAll\('configuration_changed'\)/);
assert.match(main,/integratedManual.closeAll\('app_exit'\)/);
console.log('Integrated manual engine eligibility, navigation isolation and teardown: OK');
