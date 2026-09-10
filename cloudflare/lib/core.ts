export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  USERFLEX_PROXY_MASTER_KEY?: string;
  USERFLEX_PROXY_KEY_VERSION?: string;
  CREATORTOOLS_AUTH_ORIGIN?: string;
}

export class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message?: string) { super(message || code); this.status = status; this.code = code; }
}

export const ADMIN_COOKIE = 'uf_admin_session';
export const ADMIN_MAX_AGE = 8 * 60 * 60;
export const CLIENT_SESSION_SECONDS = 12 * 60 * 60;
export const PBKDF2_ITERATIONS = 310_000;
export const DEFAULT_AUTH_ORIGIN = 'https://creatortools-reconstruction-lab.luis5afp.workers.dev';

export function securityHeaders(): Headers {
  return new Headers({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
}
export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const h = securityHeaders(); h.set('Content-Type', 'application/json; charset=utf-8'); h.set('Cache-Control', 'no-store');
  if (extra) new Headers(extra).forEach((v,k)=>h.set(k,v)); return new Response(JSON.stringify(data), { status, headers: h });
}
export function withSecurity(r: Response): Response { const h = new Headers(r.headers); securityHeaders().forEach((v,k)=>h.set(k,v)); return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h}); }

function config(env: Env) { const url=env.SUPABASE_URL?.replace(/\/$/,''); const key=env.SUPABASE_SERVICE_ROLE_KEY; if(!url||!key) throw new HttpError(503,'SUPABASE_CONFIG_MISSING','Supabase no está configurado.'); return {url,key}; }
export async function sb(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const {url,key}=config(env); const headers=new Headers(init.headers); headers.set('apikey',key); headers.set('Authorization',`Bearer ${key}`); headers.set('Accept','application/json'); if(init.body&&!headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const r=await fetch(`${url}/rest/v1/${path}`,{...init,headers}); const text=await r.text(); let body:any=null; if(text){try{body=JSON.parse(text)}catch{body=text}}
  if(!r.ok){ const msg=typeof body==='string'?body:(body?.message||body?.code||''); console.error('Supabase',r.status,path,String(msg).slice(0,180)); if(String(msg).includes('USERFLEX_PROFILE_LIMIT_REACHED')) throw new HttpError(409,'PROFILE_LIMIT_REACHED','El plan ya alcanzó el máximo de perfiles.'); if(String(msg).includes('USERFLEX_SUBSCRIPTION_INACTIVE')) throw new HttpError(409,'SUBSCRIPTION_INACTIVE','El cliente no tiene una suscripción activa.'); throw new HttpError(502,'DATABASE_ERROR','No se pudo completar la operación en la base de datos.'); }
  return body;
}
export async function bodyJson(request: Request, max=32768): Promise<any> { const len=Number(request.headers.get('content-length')||0); if(len>max) throw new HttpError(413,'PAYLOAD_TOO_LARGE'); const t=await request.text(); if(t.length>max) throw new HttpError(413,'PAYLOAD_TOO_LARGE'); if(!t)return{}; try{const v=JSON.parse(t); if(!v||typeof v!=='object'||Array.isArray(v))throw 0; return v}catch{throw new HttpError(400,'INVALID_JSON')} }
export function text(v:unknown,field:string,max=255){const s=typeof v==='string'?v.trim():'';if(!s||s.length>max)throw new HttpError(400,'INVALID_FIELD',`${field} no es válido.`);return s}
export function optional(v:unknown,max=255):string|null{if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'||v.trim().length>max)throw new HttpError(400,'INVALID_FIELD');return v.trim()}
export function integer(v:unknown,min:number,max:number,field:string){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new HttpError(400,'INVALID_FIELD',`${field} no es válido.`);return n}
export function iso(v:unknown,field:string){const s=text(v,field,80);const d=new Date(s);if(!Number.isFinite(d.getTime()))throw new HttpError(400,'INVALID_FIELD',`${field} no es válido.`);return d.toISOString()}
export function httpsUrl(v:unknown,field:string,optionalValue=false):string|null{if(optionalValue&&(v===undefined||v===null||v===''))return null;const raw=text(v,field,2048);let u:URL;try{u=new URL(raw)}catch{throw new HttpError(400,'INVALID_URL')};if(u.protocol!=='https:')throw new HttpError(400,'HTTPS_REQUIRED',`${field} debe usar HTTPS.`);u.username='';u.password='';return u.toString()}
export function cookie(request:Request,name:string){for(const p of (request.headers.get('cookie')||'').split(';')){const [k,...r]=p.trim().split('=');if(k===name)return decodeURIComponent(r.join('='))}return null}
export function adminCookie(token:string,maxAge=ADMIN_MAX_AGE){return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`}
export function clearAdminCookie(){return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`}
function b64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
function unb64(v:string){const n=v.replace(/-/g,'+').replace(/_/g,'/');const d=atob(n+'='.repeat((4-n.length%4)%4));return Uint8Array.from(d,c=>c.charCodeAt(0))}
export function token(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return b64(a)}
export async function sha(v:string){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));return Array.from(d,b=>b.toString(16).padStart(2,'0')).join('')}
export async function passwordHash(password:string){if(password.length<10||password.length>256)throw new HttpError(400,'WEAK_PASSWORD','La contraseña debe tener al menos 10 caracteres.');const salt=new Uint8Array(16);crypto.getRandomValues(salt);const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:PBKDF2_ITERATIONS},k,256));return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`}
export async function passwordVerify(password:string,encoded:string){try{const [kind,it,s,e]=encoded.split('$');if(kind!=='pbkdf2-sha256'||Number(it)!==PBKDF2_ITERATIONS)return false;const salt=unb64(s),expected=unb64(e);if(salt.length!==16||expected.length!==32)return false;const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:PBKDF2_ITERATIONS},k,256));let diff=0;for(let i=0;i<32;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}}
async function proxyKey(env:Env){if(!env.USERFLEX_PROXY_MASTER_KEY)throw new HttpError(503,'PROXY_ENCRYPTION_NOT_CONFIGURED');const bytes=unb64(env.USERFLEX_PROXY_MASTER_KEY);if(bytes.length!==32)throw new HttpError(503,'PROXY_ENCRYPTION_INVALID');return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encryptProxy(env:Env,password:string){const key=await proxyKey(env),iv=new Uint8Array(12);crypto.getRandomValues(iv);const c=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(password)));return{ciphertext:b64(c),iv:b64(iv),keyVersion:env.USERFLEX_PROXY_KEY_VERSION||'v1'}}
export async function decryptProxy(env:Env,c:string,iv:string){const key=await proxyKey(env);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(c)))}

export async function audit(env:Env,request:Request,actorType:'admin'|'client'|'system',actorId:string|null,action:string,entityType?:string,entityId?:string,details:Record<string,unknown>={}){const ip=request.headers.get('cf-connecting-ip');const ipHash=ip?await sha(`userflex-ip:${ip}`):null;await sb(env,'userflex_audit_logs',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({actor_type:actorType,actor_id:actorId,action,entity_type:entityType||null,entity_id:entityId||null,ip_hash:ipHash,details})})}
export async function loginGuard(env:Env,request:Request,scope:string,identity=''){const ip=request.headers.get('cf-connecting-ip')||'unknown';const key=await sha(`userflex-login:${scope}:${ip}:${identity.toLowerCase()}`);const result=await sb(env,'rpc/userflex_login_guard',{method:'POST',body:JSON.stringify({p_ip_hash:key})});const row=Array.isArray(result)?result[0]:result;if(row?.allowed===false)throw new HttpError(429,'RATE_LIMITED','Demasiados intentos.');return key}
export async function resetGuard(env:Env,key:string){await sb(env,'rpc/userflex_login_guard_reset',{method:'POST',body:JSON.stringify({p_ip_hash:key})})}
