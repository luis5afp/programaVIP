import http from 'node:http';
import {createDesktopBridge,BridgeError} from './desktop-bridge.mjs';
import {verifyDeviceProof,publicKeyId} from './device-proof.mjs';
import {DurableBridgeStore} from './durable-store.mjs';
const fail=(status,message)=>{throw new BridgeError(status,message);};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const tokenOf=req=>/^Bearer ([A-Za-z0-9_-]{40,})$/.exec(req.headers.authorization||'')?.[1]||'';
const credentialsError=new BridgeError(401,'Invalid credentials');
// Separate staging service. It deliberately does not mount any legacy API routes.
export function createBridgeGateway({store,now=Date.now}){
 const bridge=createDesktopBridge({authenticate:args=>store.authenticate(args),sessions:store.sessions,readData:()=>store.readData(),readBundle:args=>store.readBundle(args),now,audit:e=>store.audit(e.action,e.clientId||'',e)});
 const attempts=new Map();
 function limit(key){const t=now(),r=attempts.get(key)||{count:0,until:t+900000};if(r.until<=t){r.count=0;r.until=t+900000;}if(++r.count>10)fail(429,'Too many attempts');attempts.set(key,r);}
 async function dispatch(req,body,raw,path){
  const method=req.method.toUpperCase(),h=req.headers;
  if(req.url.includes('?'))fail(400,'Query strings are not accepted');
  if(h.origin)fail(403,'Browser origins are not accepted by this native API');
  if(method==='GET'&&path==='/health')return {status:'ok',protocol:'userflex-bridge-v1.1'};
  if(method==='POST'&&path==='/admin/login'){limit('admin:'+req.socket.remoteAddress+':'+body.username);return store.adminLogin(body.username,body.password);}
  if(path.startsWith('/admin/')){
   const token=tokenOf(req);store.requireAdmin(token);
   if(method==='POST'&&path==='/admin/logout'){store.adminLogout(token);return {success:true};}
   if(method==='GET'&&path==='/admin/state')return {data:store.readData(),devices:store.listDevices(),audit:store.auditEntries()};
   if(method==='PUT'&&path==='/admin/clients')return {client:store.upsertClient(body)};
   if(method==='PUT'&&path==='/admin/modules')return {module:store.upsertModule(body)};
   if(method==='PUT'&&path==='/admin/profiles')return {profile:store.upsertProfile(body.moduleId,body)};
   if(method==='POST'&&path==='/admin/credentials'){store.setCredential(body.clientId,body.username,body.password);return {success:true};}
   if(method==='POST'&&path==='/admin/devices'){store.setDeviceStatus(body.clientId,body.deviceId,body.status);return {success:true};}
   if(method==='POST'&&path==='/admin/bundles')return {data:store.writeBundle(body)};
   if(method==='DELETE'&&path==='/admin/bundles'){store.revokeBundle(body.clientId,body.moduleId,body.profileId);return {success:true};}
   if(method==='POST'&&path==='/admin/revoke-client'){if(!id(body.clientId))fail(400,'Invalid client');store.suspendClient(body.clientId);return {success:true};}
   fail(404,'Not found');
  }
  if(path==='/enroll'&&method==='POST'){
   limit('enroll:'+req.socket.remoteAddress+':'+body.identifier);
   const key=body.publicKey;let deviceId;try{deviceId=publicKeyId(key);}catch{fail(401,'Invalid device identity');}
   if(body.deviceId!==deviceId)fail(401,'Invalid device identity');
   verifyDeviceProof({headers:h,method,path,body:raw,publicKey:key,store,now});
   const identity=store.authenticate({identifier:body.identifier,password:body.password,deviceId});
   if(!identity)throw credentialsError;
   const client=store.readData().clients.find(c=>c.id===identity.clientId);
   if(!client||client.status!=='active')fail(403,'Client access denied');
   return store.enroll(client.id,deviceId,key);
  }
  const deviceId=h['x-device-id'],device=store.device(deviceId);
  if(!device)fail(401,'Device not enrolled');
  verifyDeviceProof({headers:h,method,path,body:raw,publicKey:device.public_key,store,now});
  if(path==='/login'&&method==='POST'){
   limit('login:'+req.socket.remoteAddress+':'+body.identifier);
   if(device.status!=='active')fail(403,'Device not approved');
   return bridge.login({...body,deviceId});
  }
  if(device.status!=='active')fail(403,'Device not approved');
  const token=tokenOf(req);if(!token)fail(401,'Authentication required');
  if(method==='GET'&&path==='/catalog'){
   const catalog=await bridge.catalog(token,deviceId);
   for(const m of catalog.modules)for(const p of m.profiles)p.sessionAvailable=!!store.bundleMetadata({clientId:catalog.client.id,moduleId:m.id,profileId:p.id});
   return catalog;
  }
  if(method==='POST'&&path==='/session')return bridge.bundle(token,deviceId,body.moduleId,body.profileId);
  if(method==='POST'&&path==='/heartbeat')return bridge.heartbeat(token,deviceId);
  if(method==='POST'&&path==='/logout')return bridge.logout(token,deviceId);
  fail(404,'Not found');
 }
 const handler=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Referrer-Policy','no-referrer');
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  try{
   const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/api/bridge/v1/'))fail(404,'Not found');
   if(!['GET','POST','PUT','DELETE'].includes(req.method))fail(405,'Method not allowed');
   if(req.method!=='GET'&&!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON required');
   const limit=path==='/api/bridge/v1/admin/bundles'?1048576:65536;
   if(Number(req.headers['content-length']||0)>limit)fail(413,'Request too large');
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>limit)fail(413,'Request too large');}
   const body=raw?JSON.parse(raw):{};if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'JSON object required');
   send(200,await dispatch(req,body,raw,path.slice('/api/bridge/v1'.length)));
  }catch(error){send(error instanceof BridgeError?error.status:error instanceof SyntaxError?400:500,{error:error instanceof BridgeError?error.message:'Request failed'});}
 };
 return {handler,listen:(port=0,host='127.0.0.1')=>new Promise(resolve=>{const server=http.createServer(handler);server.listen(port,host,()=>resolve(server));})};
}
export function createLocalBridge(options){const store=new DurableBridgeStore(options);return {store,...createBridgeGateway({store,now:options.now})};}
