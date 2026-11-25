const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFixture,healthCheck}=require('./fixture.cjs');
test('public health only, no redirects, no credentials',async()=>{
  const state=await healthCheck(async(url,options)=>{
    assert.equal(url,'https://userflex-admin.luis5afp.workers.dev/api/health');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,undefined);
    return {ok:true,json:async()=>({ok:true,service:'userFLEX Admin API',databaseReachable:true})};
  });
  assert.equal(state,'Servidor y base de datos disponibles');
});
test('local fixture rejects cross-origin POST',async()=>{
  const f=await createFixture();
  try{
    const first=await fetch(f.origin);
    assert.match(await first.text(),/Sin sesión de demostración/);
    assert.equal((await fetch(f.origin+'/login',{method:'POST',headers:{Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(f.origin+'/login',{method:'POST',headers:{Origin:f.origin},redirect:'manual'})).status,303);
    assert.equal((await fetch(f.origin+'/missing')).status,404);
  }finally{await f.close();}
});
