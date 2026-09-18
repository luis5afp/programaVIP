import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeHttpHandler} from './desktop-bridge-http.mjs';
const handler=createBridgeHttpHandler({login:async()=>({token:'x'.repeat(43)}),catalog:async()=>({modules:[]}),bundle:async()=>({cookies:[]}),heartbeat:async()=>({authorized:true}),logout:async()=>({success:true})});
async function call(method,path,headers={},body={}) {
 let code, value, responseHeaders={};
 const res={setHeader:(k,v)=>{responseHeaders[k]=v;},status(n){code=n;return this;},json(v){value=v;return this;}};
 await handler({method,path,headers,body},res);
 return {code,value,headers:responseHeaders};
}
test('native login uses JSON and responses cannot be cached',async()=>{const r=await call('POST','/login',{'content-type':'application/json'});assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store, private');});
test('browser origins, missing bearer and oversized bodies are denied',async()=>{assert.equal((await call('POST','/login',{origin:'https://evil.test','content-type':'application/json'})).code,403);assert.equal((await call('GET','/catalog')).code,401);assert.equal((await call('POST','/session',{'content-type':'application/json','content-length':'999999'})).code,413);});
test('only exact supported endpoints are routed',async()=>{const h={authorization:'Bearer '+'x'.repeat(43),'x-device-id':'device-a','content-type':'application/json'};assert.equal((await call('GET','/catalog',h)).code,200);assert.equal((await call('POST','/session',h)).code,200);assert.equal((await call('GET','/session',h)).code,404);});
test('unexpected errors do not expose internal details',async()=>{const failing=createBridgeHttpHandler({login:async()=>{throw new Error('secret internal error')}});let result;await failing({method:'POST',path:'/login',headers:{'content-type':'application/json'},body:{}},{setHeader(){},status(){return this;},json(v){result=v;}});assert.equal(result.error,'Internal server error');});
