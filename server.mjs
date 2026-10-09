import http from 'node:http';
import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { randomUUID,randomBytes } from 'node:crypto';
import { BrowserBridge,youtubeURL } from './lib/browser.mjs';
import { generateCard,loginStatus } from './lib/codex.mjs';
import { transcriptText,needsSegment,currentCard,scheduleReview,validateCard } from './lib/cards.mjs';
import {sealedCues,captionLag} from './lib/transcript.mjs';
import {extensionId,allowedOrigin} from './lib/extension.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.COMPANION_PORT || 4318),origin=`http://127.0.0.1:${port}`;
const extensionManifest=JSON.parse(await readFile(join(root,'extension','manifest.json'),'utf8'));
const extensionOrigin=`chrome-extension://${extensionId(extensionManifest.key)}`;
let installed={};try{installed=JSON.parse(await readFile(join(root,'native','install-config.json'),'utf8'));}catch{}
const dataDir=process.env.COMPANION_DATA_DIR||installed.dataDir||join(root,'data');
const dbPath=join(dataDir,'notebook.json'),token=randomBytes(24).toString('hex');
await mkdir(dataDir,{recursive:true});
let db={version:1,activeId:null,courses:[]};
try {db=JSON.parse(await readFile(dbPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('笔记文件无法读取，请保留原文件并检查格式。');}
let writeQueue=Promise.resolve();
function save() {
  const value=JSON.stringify(db,null,2);
  writeQueue=writeQueue.catch(()=>{}).then(async()=>{await writeFile(dbPath+'.tmp',value,{mode:0o600});await rename(dbPath+'.tmp',dbPath);});
  return writeQueue;
}
let bridge=null,loop=null,ticking=false,handledSeq=0,lastRequest=0,epoch=-1,controller=null,failures=0;
let runtime={phase:'idle',message:'粘贴课程链接，开始一起看。',playback:null,generating:false,error:'',watchId:null,epoch:0,captionCount:0,captionLag:0,lastCaptionTime:null,generationStartedAt:null,lastGenerationMs:null,mcpConnected:false};
let codexReady=await loginStatus();
const subscribers=new Set();
const active=()=>db.courses.find(c=>c.id===db.activeId);
function state() {
  const course=active();const time=runtime.playback?.time ?? course?.progress ?? 0;
  const exact=currentCard(course?.cards??[],time);
  const recent=course?.cards.filter(c=>c.end<=time).sort((a,b)=>a.end-b.end).at(-1);
  return {courses:db.courses.map(c=>({id:c.id,title:c.title,url:c.url,cardCount:c.cards.length,savedCount:c.cards.filter(x=>x.saved).length,progress:c.progress||0,updatedAt:c.updatedAt})),course:course?{...course,cues:undefined,transcript:undefined}:null,runtime:{...runtime,playback:runtime.playback?{...runtime.playback,entries:undefined}:null,codexReady},currentCard:exact ?? recent ?? null,currentKind:exact?'current':recent?'recent':'none'};
}
function publish(){const payload=`data: ${JSON.stringify(state())}\n\n`;for(const res of subscribers)res.write(payload);}
function friendly(error){return String(error.message || error).slice(0,250);}
function update(patch){Object.assign(runtime,patch);publish();}
async function stop() {
  clearInterval(loop);loop=null;controller?.abort();controller=null;
  const old=bridge;bridge=null;if(old)await old.close();
  update({phase:'idle',message:'陪看已停止，笔记已保留。',generating:false,mcpConnected:false,generationStartedAt:null});await save();
}
async function start(input,options={}) {
  const video=youtubeURL(input);await stop();
  let course=db.courses.find(c=>c.id===video.id);
  if(!course){course={...video,title:'正在打开课程…',cards:[],cues:[],progress:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.courses.push(course);}
  db.activeId=video.id;handledSeq=0;epoch=-1;lastRequest=0;failures=0;
  update({phase:'connecting',message:options.tabId?'正在连接当前 YouTube 视频…':'正在独立窗口打开课程…',error:'',playback:null,watchId:randomUUID(),epoch:0,captionCount:0,lastCaptionTime:null,tabId:options.tabId??null});await save();
  const connection=new BrowserBridge();bridge=connection;
  try {
    const sample=await connection.connect(video.url,options);if(bridge!==connection){await connection.close();return;}
    for(const stored of db.courses)if(stored.transcript?.length)connection.setTimeline(stored.id,stored.transcript);
    ingest(sample);
    loop=setInterval(()=>tick(),900);await tick();
  }catch(error){await connection.close();if(bridge!==connection)return;bridge=null;update({phase:'error',message:'课程连接未完成。',error:friendly(error)});}
}
function ingest(sample) {
  let course=active();if(!course)return;
  const sampleId=new URL(sample.url).searchParams.get('v');
  if(!sample.ready){update({phase:'loading',message:'等待视频播放器加载…'});return;}
  if(sampleId && sampleId!==course.id){
    controller?.abort();controller=null;
    const video=youtubeURL(sample.url);
    course=db.courses.find(c=>c.id===video.id);
    if(!course){course={...video,title:sample.title,cards:[],cues:[],progress:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.courses.push(course);}
    db.activeId=video.id;handledSeq=0;epoch=-1;lastRequest=0;
    Object.assign(runtime,{watchId:randomUUID(),generating:false,error:'',generationStartedAt:null});
    if(course.transcript?.length)bridge?.setTimeline(video.id,course.transcript);
  }
  if(epoch!==sample.epoch) {
    controller?.abort();epoch=sample.epoch;handledSeq=0;
    // Old ranges stay in the notebook but cannot join this seek's segment.
    update({epoch,generating:false,error:''});
  }
  course.title=sample.title||course.title;course.progress=sample.time;course.updatedAt=new Date().toISOString();
  if(sample.timelineReady&&bridge?.timelines.get(course.id))course.transcript=bridge.timelines.get(course.id);
  const existing=new Map(course.cues.filter(c=>c.watchId===runtime.watchId && c.epoch===epoch).map(c=>[c.seq,c]));
  for(const cue of sample.entries??[]) {
    const old=existing.get(cue.seq);
    if(old)Object.assign(old,cue);else course.cues.push({...cue,watchId:runtime.watchId,epoch});
  }
  if(course.cues.length>30000)course.cues.splice(0,course.cues.length-30000);
  const has=(sample.entries??[]).some(c=>c.text && !/^\([^)]*\)$/.test(c.text));
  const lag=captionLag(sample.entries??[],sample.time),lastCaptionTime=sample.entries?.at(-1)?.end??null;
  const stalled=lag>15&&!sample.timelineReady&&!sample.paused;
  update({playback:sample,captionCount:(sample.entries??[]).length,captionLag:lag,lastCaptionTime,mcpConnected:true,lastReadAt:new Date().toISOString(),phase:sample.paused?'paused':'watching',error:stalled?'字幕读取已落后，正在尝试逐字稿备用读取。':'',message:stalled?'字幕未继续更新，暂时无法生成新的小结。':!sample.cc?'请在视频中打开 CC 字幕。':has?(sample.paused?'视频已暂停，可以回顾刚刚的小结。':'正在跟随播放，收集这一段的讲解…'):'等待字幕出现…'});
}
async function tick() {
  if(ticking||!bridge)return;ticking=true;const connection=bridge;
  try {
    const sample=await connection.read();if(connection!==bridge)return;ingest(sample);failures=0;
    if(sample.ready && sample.cc) {
      const cues=active().cues.filter(c=>c.watchId===runtime.watchId&&c.epoch===epoch&&c.seq>handledSeq);
      // Keep the unfinished rolling caption out until another cue or a pause.
      const sealed=sealedCues(cues,sample.time,sample.paused||sample.ended);
      if(!runtime.generating && needsSegment(sealed,sample.time,lastRequest,sample.paused))void summarize(sealed);
    }
    await save();
  } catch(error){if(connection!==bridge)return;failures++;update({error:friendly(error),message:'读取暂时中断，正在等待连接恢复。',...(failures>=3?{phase:'error'}:{})});}
  finally{ticking=false;}
}
async function summarize(cues) {
  if(runtime.generating)throw Error('正在生成上一段小结，请稍候。');
  const course=active();if(!course)throw Error('请先连接课程。');
  cues ||= course.cues.filter(c=>c.watchId===runtime.watchId&&c.epoch===epoch&&c.seq>handledSeq);
  const text=transcriptText(cues);if(text.length<80)throw Error('目前字幕还太少，再看一小段后总结。');
  const snapshot={courseId:course.id,watchId:runtime.watchId,epoch,seq:cues.at(-1).seq,start:cues[0].start,end:cues.at(-1).end};
  const ac=new AbortController();controller=ac;lastRequest=Date.now();update({generating:true,error:'',generationStartedAt:new Date().toISOString()});
  try {
    const result=await generateCard({title:course.title,text,start:snapshot.start,end:snapshot.end},ac.signal);
    if(ac.signal.aborted||runtime.watchId!==snapshot.watchId||epoch!==snapshot.epoch)return;
    const card={...result,id:randomUUID(),...snapshot,origin:'codex',saved:false,note:'',createdAt:new Date().toISOString(),review:null,sourceText:text};
    course.cards.push(card);handledSeq=snapshot.seq;await save();update({message:'新小结已到，随时可以保存或回看。',lastGenerationMs:Date.now()-lastRequest});
  } catch(error){if(!ac.signal.aborted)update({error:friendly(error)});}
  finally{if(controller===ac){controller=null;update({generating:false,generationStartedAt:null});}}
}
function markdown(course) {
  const selected=course.cards.filter(c=>c.saved);
  return `# ${course.title}\n\n来源：${course.url}\n\n${(selected.length?selected:course.cards).map(c=>`## ${c.title}\n\n[回看 ${Math.floor(c.start/60)}:${String(Math.floor(c.start%60)).padStart(2,'0')}](${course.url}&t=${Math.floor(c.start)}s)\n\n${c.summary}\n\n${c.keyPoints.map(p=>'- '+p).join('\n')}\n\n${c.formula?'公式：'+c.formula+'\n\n':''}${c.example?'辅助理解：'+c.example+'\n\n':''}自测：${c.question}\n\n参考回答：${c.answer}\n\n${c.note?'我的笔记：'+c.note+'\n\n':''}${c.evidenceQuote?'原文摘录：'+c.evidenceQuote+'\n\n':''}${c.uncertainty?'待核对：'+c.uncertainty+'\n\n':''}`).join('---\n\n')}`;
}
async function body(req) {
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)throw Error('请求过大。');}return JSON.parse(raw||'{}');
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
  try {
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,{error:'不允许的访问地址。'},403);
    if(!allowedOrigin(req.headers.origin,port,extensionId(extensionManifest.key)))return json(res,{error:'请从本地伴学页面或伴学扩展访问。'},403);
    if(req.headers.origin===extensionOrigin){res.setHeader('Access-Control-Allow-Origin',extensionOrigin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){
      if(req.headers.origin!==extensionOrigin)return json(res,{error:'不允许的跨站请求。'},403);
      res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Companion-Token'});return res.end();
    }
    const url=new URL(req.url,origin),path=url.pathname;
    if(req.method==='GET' && path==='/api/bootstrap')return json(res,{token});
    if(req.method==='GET' && path==='/api/state')return json(res,state());
    if(req.method==='GET' && path==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});subscribers.add(res);res.write(`data: ${JSON.stringify(state())}\n\n`);req.on('close',()=>subscribers.delete(res));return;
    }
    if(req.method==='GET' && path==='/api/export') {
      const course=db.courses.find(c=>c.id===(url.searchParams.get('id')||db.activeId));if(!course)throw Error('尚无课程笔记。');
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="lecture-${course.id}.md"`});return res.end(markdown(course));
    }
    if(req.method==='POST') {
      if(req.headers['x-companion-token']!==token)return json(res,{error:'页面会话已过期，请刷新。'},403);
      if(!req.headers['content-type']?.startsWith('application/json'))return json(res,{error:'请求格式错误。'},415);
      const data=await body(req);
      if(path==='/api/start') {youtubeURL(data.url);if(runtime.phase==='connecting')throw Error('正在连接，请稍候。');if(data.tabId!==undefined&&!Number.isSafeInteger(data.tabId))throw Error('窗口标识无效。');void start(data.url,{tabId:data.tabId,pause:data.tabId?false:true}).catch(e=>update({phase:'error',error:friendly(e)}));return json(res,{ok:true});}
      if(path==='/api/transcript'){
        const course=db.courses.find(c=>c.id===data.id);if(!course)throw Error('课程不存在。');
        if(!Array.isArray(data.cues)||data.cues.length>10000||data.cues.some(c=>typeof c.text!=='string'||c.text.length>2000||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<c.start))throw Error('逐字稿格式无效。');
        course.transcript=data.cues.sort((a,b)=>a.start-b.start);bridge?.setTimeline(course.id,course.transcript);await save();return json(res,{ok:true,cues:course.transcript.length});
      }
      if(path==='/api/stop'){await stop();return json(res,{ok:true});}
      if(path==='/api/select'){if(bridge)await stop();if(!db.courses.some(c=>c.id===data.id))throw Error('课程不存在。');db.activeId=data.id;runtime.playback=null;await save();publish();return json(res,{ok:true});}
      if(path==='/api/control'){if(!bridge)throw Error('请先连接课程。');if(!['seek','play','pause'].includes(data.action))throw Error('操作无效。');await bridge.control(data.action,data.time);await tick();return json(res,{ok:true});}
      if(path==='/api/summarize'){if(runtime.generating)throw Error('正在生成小结，请稍候。');const cues=active()?.cues.filter(c=>c.watchId===runtime.watchId&&c.epoch===epoch&&c.seq>handledSeq);if(!cues?.length||transcriptText(cues).length<80)throw Error('再看一小段，让字幕积累后总结。');void summarize(cues);return json(res,{ok:true});}
      if(path==='/api/card') {
        const course=db.courses.find(c=>c.id===data.courseId),card=course?.cards.find(c=>c.id===data.id);if(!card)throw Error('卡片不存在。');
        if(typeof data.saved==='boolean')card.saved=data.saved;
        if(typeof data.note==='string')card.note=data.note.slice(0,10000);
        if(data.rating){if(!['again','hard','good','easy'].includes(data.rating))throw Error('复习选项无效。');card.review=scheduleReview(card.review,data.rating);card.saved=true;}
        await save();publish();return json(res,{ok:true});
      }
      if(path==='/api/context')return json(res,{course:active()?.title,time:runtime.playback?.time,phase:runtime.phase,cues:active()?.cues.filter(c=>c.watchId===runtime.watchId&&c.epoch===runtime.epoch&&c.end<=(runtime.playback?.time??Infinity)).slice(-80),cards:active()?.cards.slice(-5)});
      if(path==='/api/assistant-card') {
        const course=data.courseId?db.courses.find(c=>c.id===data.courseId):active();if(!course)throw Error('请先选择课程。');const start=Number(data.start),end=Number(data.end);
        if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start)throw Error('时间区间无效。');
        if(end>course.progress)throw Error('只能总结已经看过的区间。');
        const recovered=data.source==='transcript';
        const source=transcriptText((recovered?course.transcript??[]:course.cues).filter(c=>c.start>=start && c.end<=end));if(!source)throw Error('该区间没有已读取的字幕。');
        const card=validateCard(data.card,source);course.cards.push({...card,id:randomUUID(),start,end,origin:recovered?'recovered':'assistant',saved:true,note:'',createdAt:new Date().toISOString(),sourceText:source,review:null});await save();publish();return json(res,{ok:true});
      }
      return json(res,{error:'功能不存在。'},404);
    }
    if(req.method==='GET' && ['/','/app.js','/style.css'].includes(path)) {
      const file=path==='/'?'index.html':path.slice(1),types={html:'text/html',js:'text/javascript',css:'text/css'};
      res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self' ${extensionOrigin}`});return res.end(await readFile(join(root,'public',file)));
    }
    json(res,{error:'页面不存在。'},404);
  }catch(error){json(res,{error:friendly(error)},400);}
});
server.listen(port,'127.0.0.1',()=>console.log(`伴学已打开：${origin}`));
async function shutdown(){await stop();for(const res of subscribers)res.end();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),45000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
