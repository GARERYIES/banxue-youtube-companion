import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Local stdio MCP transport. No account, token file or public tunnel is involved.
export class McpClient {
  constructor(command, args = []) { this.command = command; this.args = args; this.pending = new Map(); this.id = 0; }
  async connect() {
    this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.fail('无法启动本地浏览器连接。'));
    this.child.on('exit', () => this.fail('本地浏览器连接已断开。'));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(msg.id);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(msg.id); msg.error ? pending.reject(Error(msg.error.message)) : pending.resolve(msg.result); }
      else if (msg.id !== undefined && msg.method) this.child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:msg.id, error:{ code:-32601, message:'Unsupported request' } })+'\n');
    });
    await this.request('initialize', { protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'lecture-companion-local',version:'0.1.0'} });
    this.child.stdin.write(JSON.stringify({ jsonrpc:'2.0',method:'notifications/initialized' })+'\n');
  }
  request(method, params, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {this.pending.delete(id); reject(Error('浏览器连接超时，请重试。'));}, timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({ jsonrpc:'2.0',id,method,params })+'\n', error => { if(error) {clearTimeout(timer); this.pending.delete(id); reject(Error('浏览器连接已关闭。'));} });
    });
  }
  async call(name, args) {
    const result = await this.request('tools/call', {name,arguments:args});
    let value;
    for (const item of result.content ?? []) if (item.type === 'text') {
      let parsed; try {parsed=JSON.parse(item.text);} catch {continue;}
      if (parsed.ok === false) throw Error(parsed.error?.message ?? '浏览器读取失败。');
      if (parsed.ok === true) { if ('value' in parsed) {if(parsed.value !== true)value=parsed.value;} else value=parsed; }
      else value=parsed;
    }
    if(result.isError) throw Error('浏览器读取失败。');
    return value;
  }
  js(code) {
    const next=(this.jsQueue||Promise.resolve()).then(()=>this.call('js',{code,maxChars:120000,timeoutMs:30000}));
    this.jsQueue=next.catch(()=>{});return next;
  }
  fail(message) { for(const p of this.pending.values()) {clearTimeout(p.timer); p.reject(Error(message));} this.pending.clear(); }
  async close() {
    this.fail('连接已停止。');
    const child=this.child;if(!child||child.exitCode!==null)return;
    await new Promise(resolve=>{
      child.once('exit',resolve);child.stdin.end();
      const timer=setTimeout(()=>{child.kill();resolve();},2000);timer.unref();child.once('exit',()=>clearTimeout(timer));
    });
  }
}
