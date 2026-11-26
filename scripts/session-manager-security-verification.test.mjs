import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {securityVerificationState} from '../session-manager/browser-engine/security-verification.js';
const element=(src='',title='',shown=true)=>({getAttribute:key=>key==='src'?src:title,getBoundingClientRect:()=>({width:shown?300:0,height:shown?80:0})});
const fixture=(text='',frames=[],widgets=[])=>({body:{innerText:text},querySelectorAll:selector=>selector==='iframe'?frames:widgets,defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})}});
for(const phrase of ['Verifique que es un ser humano','Verify you are a human','Verificando que eres humano','La verificación falló','Checking your browser']){
 assert.equal(securityVerificationState(fixture(phrase)),'pending',phrase);
}
assert.equal(securityVerificationState(fixture('',[element('https://challenges.cloudflare.com/fixture')])),'pending');
assert.equal(securityVerificationState(fixture('',[],[element()])),'pending');
assert.equal(securityVerificationState(fixture('Workspace',[element('https://challenges.cloudflare.com/fixture','',false)])),'not-detected');
assert.equal(securityVerificationState(fixture('Workspace')),'not-detected');
assert.equal(securityVerificationState({}),'unknown');
const state=readFileSync(new URL('../session-manager/browser-engine/capture-state.js',import.meta.url),'utf8');
assert.match(state,/securityVerification !== 'not-detected'/);
assert.match(state,/securityVerificationAfter === 'not-detected'/);
const engine=readFileSync(new URL('../session-manager/browser-engine/kaizen-capture-engine.js',import.meta.url),'utf8');
assert.match(engine,/inspection\?\.securityVerification === 'pending'/);
console.log('Pending security verification must block authentication confirmation: OK');
