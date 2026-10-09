import {mkdir,writeFile,readFile,chmod,cp,access} from 'node:fs/promises';import {homedir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {extensionId} from '../lib/extension.mjs';
if(process.platform!=='darwin')throw Error('一键本地连接目前仅支持 macOS + Google Chrome。');
const root=dirname(dirname(fileURLToPath(import.meta.url))),host='com.banxue.companion';
const manifest=JSON.parse(await readFile(join(root,'extension','manifest.json'),'utf8')),id=extensionId(manifest.key);
// Chrome's native host lives outside protected Documents folders on macOS.
const runtime=join(homedir(),'Library','Application Support','Banxue');
await mkdir(join(runtime,'native'),{recursive:true});await mkdir(join(runtime,'extension'),{recursive:true});await mkdir(join(runtime,'data'),{recursive:true});
for(const file of ['server.mjs','start.mjs','lib','public'])await cp(join(root,file),join(runtime,file),{recursive:true,force:true});
await cp(join(root,'native','host.mjs'),join(runtime,'native','host.mjs'));await cp(join(root,'extension','manifest.json'),join(runtime,'extension','manifest.json'));
try{await access(join(runtime,'data','notebook.json'));}catch{try{await cp(join(root,'data','notebook.json'),join(runtime,'data','notebook.json'));}catch(error){if(error.code!=='ENOENT')throw error;}}
await writeFile(join(root,'native','install-config.json'),JSON.stringify({runtime,dataDir:join(runtime,'data')},null,2)+'\n');
const executable=join(runtime,'native','launch-host');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const logs=join(homedir(),'Library','Logs','Banxue');await mkdir(logs,{recursive:true});
await writeFile(executable,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(runtime,'native','host.mjs'))} "$@" 2>>${quote(join(logs,'native-host.log'))}\n`,{mode:0o700});await chmod(executable,0o700);
const directory=join(homedir(),'Library','Application Support','Google','Chrome','NativeMessagingHosts');await mkdir(directory,{recursive:true});
const target=join(directory,host+'.json');await writeFile(target,JSON.stringify({name:host,description:'伴学：仅启动这台电脑上的本地视频学习助手',path:executable,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2)+'\n',{mode:0o600});
console.log('本地连接已安装。点击 Chrome 右上角的伴学扩展即可自动启动。');console.log('扩展 ID：'+id);
