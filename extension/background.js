const ORIGIN='http://127.0.0.1:4318';
const HOST='com.banxue.companion';
let pending=null;
const status=async value=>chrome.storage.session.set({companionStatus:{...value,updatedAt:Date.now()}});
function videoURL(value){try{const url=new URL(value);return url.protocol==='https:'&&['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)&&url.pathname==='/watch'&&/^[\w-]{11}$/.test(url.searchParams.get('v')||'');}catch{return false;}}
async function health(){const res=await fetch(ORIGIN+'/api/state',{signal:AbortSignal.timeout(1500)});if(!res.ok)throw Error('伴学服务未启动');const data=await res.json();if(!Array.isArray(data.courses)||typeof data.runtime?.codexReady!=='boolean')throw Error('本地服务响应无效');return data;}
async function ensureService(){try{return await health();}catch{}
 const result=await chrome.runtime.sendNativeMessage(HOST,{action:'ensure_service'}).catch(error=>{throw Error('本地连接未能启动。请双击「安装本地连接.command」后重试。详情：'+error.message);});
 if(!result?.ok)throw Error(result?.error||'本地伴学启动失败');return health();
}
async function attach(tab){
 await status({phase:'connecting',message:'正在连接当前视频…',tabId:tab.id});
 const state=await ensureService();
 if(state.runtime.tabId===tab.id&&['watching','paused','loading','connecting'].includes(state.runtime.phase)){
   await status({phase:'ready',message:'已跟随当前视频',tabId:tab.id});return;
 }
 const {token}=await fetch(ORIGIN+'/api/bootstrap',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
 const res=await fetch(ORIGIN+'/api/start',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':token},body:JSON.stringify({url:tab.url,tabId:tab.id}),signal:AbortSignal.timeout(5000)});
 const data=await res.json();if(!res.ok)throw Error(data.error||'视频连接失败');
 await status({phase:'ready',message:'已跟随当前视频',tabId:tab.id});
}
function connect(tab){if(pending)return pending;
 if(!videoURL(tab?.url)){return status({phase:'choose',message:'打开 YouTube 视频，再点右上角「伴学」即可开始。'});}
 pending=attach(tab).catch(error=>status({phase:'error',message:error.message,tabId:tab.id})).finally(()=>pending=null);return pending;
}
// Handle the click ourselves so activeTab is granted before reading the URL.
// Open synchronously: Chrome requires the side panel call inside this gesture.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
chrome.action.onClicked.addListener(tab=>{
 chrome.sidePanel.open({windowId:tab.windowId}).catch(error=>status({phase:'error',message:error.message}));
 void connect(tab);
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='retry'){
   (async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await connect(tab);return {ok:true};})().then(respond);return true;
 }
 if(message?.type==='ensure-service'){
   ensureService().then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));return true;
 }
});
