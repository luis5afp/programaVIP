const http = require('node:http');
const {randomBytes} = require('node:crypto');
const HEALTH = 'https://userflex-admin.luis5afp.workers.dev/api/health';
async function healthCheck(fetcher = fetch) {
  try {
    const r = await fetcher(HEALTH, {redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
    if (!r.ok) return 'HTTP ' + r.status;
    const data = await r.json();
    return data.ok === true && data.service === 'userFLEX Admin API' && data.databaseReachable === true ? 'Servidor y base de datos disponibles' : 'Servicio no confirmado';
  } catch {return 'No se pudo consultar el servidor';}
}
async function createFixture({health = 'Modo de prueba local'} = {}) {
  const key = randomBytes(24).toString('hex');
  let origin;
  const server = http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.headers.host !== new URL(origin).host) {res.writeHead(403);return res.end();}
    const signedIn = String(req.headers.cookie || '').split(';').some(c=>c.trim()==='lab_demo='+key);
    if(req.method==='POST' && ['/login','/logout'].includes(req.url)){
      if(req.headers.origin!==origin){res.writeHead(403);return res.end();}
      res.setHeader('Set-Cookie',req.url==='/login'?'lab_demo='+key+'; Path=/; HttpOnly; SameSite=Strict':'lab_demo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      res.writeHead(303,{Location:'/'});return res.end();
    }
    if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const escape = x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>userFLOW LAB</title><style>body{font:16px system-ui;background:#101827;color:#eef2ff;margin:0}main{max-width:680px;margin:65px auto;padding:30px;background:#202b40;border-radius:18px}h1{font-size:32px}button{padding:12px 20px;border:0;border-radius:8px;background:#7970ec;color:white;font:inherit;cursor:pointer}small{color:#aab6d2}section{border-top:1px solid #46536a;padding:20px 0}</style><main><small>EXPERIMENTAL · 0.1.0</small><h1>userFLOW LAB</h1><p>Motor Chromium integrado, aislado de userFLOW estable.</p><section><strong>Conexión de solo lectura:</strong> '+escape(health)+'</section><section><h2>Prueba de sesión ficticia</h2><p id="state">'+(signedIn?'Sesión de demostración activa':'Sin sesión de demostración')+'</p><form method="post" action="'+(signedIn?'/logout':'/login')+'"><button id="action">'+(signedIn?'Cerrar sesión de prueba':'Iniciar sesión de prueba')+'</button></form></section><small>No utiliza cuentas, contraseñas, snapshots ni cookies de proveedores externos.</small></main></html>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  return {origin,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={createFixture,healthCheck};
