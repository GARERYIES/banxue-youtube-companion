import { createInterface } from 'node:readline';
import {cardSchema} from './lib/cards.mjs';
const endpoint=process.env.COMPANION_URL || 'http://127.0.0.1:4318';
const tools=[
 {name:'lecture_context',description:'读取本地伴学的当前课程、播放位置和已观看字幕。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'lecture_add_card',description:'根据已观看字幕，写入有时间戳的中文学习卡片。可指定已有课程 courseId；source=transcript 用缓存逐字稿补回已看部分。每个字段请使用中文；evidenceQuote 必须逐字引用已读到的字幕。',inputSchema:{type:'object',properties:{courseId:{type:'string'},source:{type:'string',enum:['observed','transcript']},start:{type:'number'},end:{type:'number'},card:cardSchema},required:['start','end','card'],additionalProperties:false}},
 {name:'lecture_seek',description:'让伴学当前连接的 YouTube 视频回到指定时间戳。',inputSchema:{type:'object',properties:{time:{type:'number'}},required:['time'],additionalProperties:false}}
];
const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
createInterface({input:process.stdin}).on('line',async line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.id===undefined)return;
 try {
  if(m.method==='initialize')return send(m.id,{protocolVersion:m.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'lecture-companion-local',version:'0.2.0'}});
  if(m.method==='ping')return send(m.id,{});
  if(m.method==='tools/list')return send(m.id,{tools});
  if(m.method==='tools/call'){
   const bootstrap=await fetch(endpoint+'/api/bootstrap').then(r=>r.json());
   const name=m.params.name,args=m.params.arguments||{};
   const paths={lecture_context:['/api/context',{}],lecture_add_card:['/api/assistant-card',args],lecture_seek:['/api/control',{action:'seek',time:args.time}]};
   if(!paths[name])throw Error('未知工具。');
   const [path,body]=paths[name];const res=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':bootstrap.token},body:JSON.stringify(body)});const data=await res.json();
   return send(m.id,{content:[{type:'text',text:JSON.stringify(data)}],...(res.ok?{}:{isError:true})});
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})+'\n');
 }catch{send(m.id,{isError:true,content:[{type:'text',text:'本地伴学未连接或请求失败。请先运行伴学软件。'}]});}
});
