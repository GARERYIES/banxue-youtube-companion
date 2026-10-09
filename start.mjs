const port=Number(process.env.COMPANION_PORT||4318),url=`http://127.0.0.1:${port}`;
let running=false;
try {
  const state=await fetch(url+'/api/state',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
  running=Array.isArray(state.courses)&&typeof state.runtime?.codexReady==='boolean';
}catch{}
if(running)console.log(`伴学正在运行，打开这里继续：${url}`);
else await import('./server.mjs');
