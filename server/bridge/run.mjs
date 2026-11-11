import {createLocalBridge} from './gateway.mjs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
const filename=process.env.BRIDGE_DB_PATH;
const key=Buffer.from(process.env.BRIDGE_VAULT_KEY||'','base64');
if(!filename||key.length!==32)throw new Error('Set BRIDGE_DB_PATH to a persistent database and BRIDGE_VAULT_KEY to a 32-byte base64 secret.');
const {store,listen}=createLocalBridge({filename,key});
const action=process.argv[2];
if(action==='bootstrap-admin'){
 const username=process.argv[3];const rl=createInterface({input:stdin,output:stdout});
 try{const password=await rl.question('Initial administrator password (input visible; use a private terminal): ');store.bootstrapAdmin(username,password);stdout.write('Administrator initialized.\n');}finally{rl.close();store.close();}
}else if(action==='serve'){
 const host=process.env.BRIDGE_LISTEN_HOST||'127.0.0.1';
 if(host!=='127.0.0.1'&&process.env.BRIDGE_ALLOW_PUBLIC_LISTEN!=='1')throw new Error('Public listening requires an explicit deployment configuration and TLS ingress.');
 const port=Number(process.env.PORT||8788);const server=await listen(port,host);
 stdout.write(`UserFlex bridge staging service listening on ${host}:${server.address().port}\n`);
 const stop=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}else{store.close();throw new Error('Use serve or bootstrap-admin <username>');}
