import {spawn} from 'node:child_process';
import {mkdir,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url))),origin='http://127.0.0.1:4318';
async function running(){try{const res=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(700)});if(!res.ok)return false;const data=await res.json();return Array.isArray(data.courses)&&typeof data.runtime?.codexReady==='boolean';}catch{return false;}}
export async function ensureService(){
 if(await running())return {ok:true,alreadyRunning:true};
 await mkdir(join(root,'data'),{recursive:true});
 const log=await open(join(root,'data','service.log'),'a',0o600);
 try{const child=spawn(process.execPath,[join(root,'start.mjs')],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PATH:`${join(homedir(),'.local/bin')}:${join(homedir(),'.npm-global/bin')}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH||''}`,COMPANION_PORT:'4318'}});child.unref();}finally{await log.close();}
 const until=Date.now()+12000;
 while(Date.now()<until){if(await running())return {ok:true,started:true};await new Promise(r=>setTimeout(r,200));}
 throw Error('本地伴学未能启动，请查看软件文件夹中的 data/service.log。');
}
function reply(data){const bytes=Buffer.from(JSON.stringify(data),'utf8'),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);process.stdout.write(Buffer.concat([header,bytes]));}
let buffer=Buffer.alloc(0),handled=false;
process.stdin.on('data',chunk=>{
 if(handled)return;buffer=Buffer.concat([buffer,chunk]);
 if(buffer.length<4)return;const length=buffer.readUInt32LE(0);
 if(length>1024){handled=true;reply({ok:false,error:'请求过大'});process.stdin.destroy();return;}
 if(buffer.length<4+length)return;handled=true;
 (async()=>{const message=JSON.parse(buffer.subarray(4,4+length).toString('utf8'));if(message.action!=='ensure_service')throw Error('操作无效');reply(await ensureService());})().catch(error=>reply({ok:false,error:error.message})).finally(()=>process.stdin.destroy());
});
