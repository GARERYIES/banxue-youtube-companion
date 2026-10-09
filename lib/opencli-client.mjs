import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {McpClient} from './mcp-client.mjs';

const run=promisify(execFile);
async function installedRoot(){
  const override=process.env.COMPANION_OPENCLI_ROOT;
  const candidates=override?[override]:[
    join(homedir(),'.npm-global/lib/node_modules/opencli-mcp'),
    '/opt/homebrew/lib/node_modules/opencli-mcp',
    '/usr/local/lib/node_modules/opencli-mcp'
  ];
  if(!override){
    try{const {stdout}=await run('npm',['root','-g'],{timeout:8000});if(stdout.trim())candidates.unshift(join(stdout.trim(),'opencli-mcp'));}catch{}
  }
  for(const candidate of candidates){try{await access(join(candidate,'dist/src/host/state.js'));return candidate;}catch{}}
  throw Error('未找到 OpenCLI 本地连接。请安装 opencli-mcp，或设置 COMPANION_OPENCLI_ROOT。');
}

// The documented local MCP endpoint gives this app a stable session that can
// be explicitly released on restart. Its host token never leaves this process.
export class OpenCliClient extends McpClient {
  constructor(){super();this.sessionId=randomUUID();}
  async connect(){
    const installed=await installedRoot();
    const {readHostState}=await import(pathToFileURL(join(installed,'dist/src/host/state.js')));
    this.readHostState=readHostState;
    await this.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'lecture-companion-local',version:'0.2.0'}});
  }
  async request(method,params,timeout=45000){
    if(this.closed)throw Error('浏览器连接已停止。');
    const host=this.readHostState();if(!host)throw Error('请打开 Chrome，并确认 OpenCLI 扩展已连接。');
    const id=++this.id;
    const response=await fetch(`http://${host.host}:${host.port}/mcp`,{
      method:'POST',headers:{authorization:`Bearer ${host.token}`,'x-opencli-session-id':this.sessionId,'content-type':'application/json',accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(timeout)
    });
    if(!response.ok)throw Error('本地浏览器连接请求失败。');
    const body=await response.text();
    const messages=response.headers.get('content-type')?.includes('text/event-stream')?body.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(body)];
    const message=messages.find(m=>m.id===id);if(!message)throw Error('本地浏览器连接没有返回结果。');
    if(message.error)throw Error(message.error.message);return message.result;
  }
  async close(){
    await this.jsQueue;
    const tabs=await this.js('nodeRepl.write(await browser.tabs.list());');
    const keep=Array.isArray(tabs)?tabs.map(t=>({tab:t.id,status:'deliverable'})):[];
    await this.call('session_finalize',{keep});
    this.closed=true;const host=this.readHostState?.();if(!host)return;
    const response=await fetch(`http://${host.host}:${host.port}/session`,{method:'DELETE',headers:{authorization:`Bearer ${host.token}`,'x-opencli-session-id':this.sessionId},signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error('伴学窗口的连接尚未释放。');
  }
}
