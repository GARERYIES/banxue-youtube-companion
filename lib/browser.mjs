import { randomUUID } from 'node:crypto';
import {OpenCliClient} from './opencli-client.mjs';
import {timelineCue} from './transcript.mjs';

export function youtubeURL(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:') throw Error('请使用 HTTPS 的 YouTube 链接。');
  let id;
  if (['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)) id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
  if (url.hostname === 'youtu.be') id=url.pathname.slice(1);
  if(!/^[\w-]{11}$/.test(id ?? '')) throw Error('请粘贴一个具体的 YouTube 视频链接。');
  return {id,url:`https://www.youtube.com/watch?v=${id}`};
}

// Samples the captions actually rendered beside the current playback position.
// No full-video transcript is sent to AI ahead of the learner.
export function samplePage() {
  const v=document.querySelector('#movie_player video')||document.querySelector('video');
  if(location.pathname!=='/watch')return {ready:false,title:document.title,url:location.href};
  if(!v) return {ready:false,title:document.title,url:location.href};
  const shownId=new URL(location.href).searchParams.get('v');
  const playingId=document.querySelector('#movie_player')?.getVideoData?.().video_id;
  if(playingId&&playingId!==shownId)return {ready:false,title:document.title,url:location.href};
  let captionText=Array.from(document.querySelectorAll('.ytp-caption-segment')).map(e=>e.textContent).join(' ').replace(/\s+/g,' ').trim();
  let captionSource='播放器字幕';
  // Existing local caption panels can replace the native caption overlay.
  // Read only the row at the current position, never the future transcript.
  if(!captionText){
    const panel=document.querySelector('#vcaptions-subtitle-iframe')?.shadowRoot;
    const rows=Array.from(panel?.querySelectorAll('[data-time-column="true"]')??[]).map(e=>{
      const parts=e.querySelector('span')?.textContent.trim().split(':').map(Number);
      const start=parts?.reduce((a,b)=>a*60+b,0);
      return {start,text:e.parentElement.querySelector('[data-allow-text-selection="true"]')?.textContent.trim()};
    }).filter(c=>Number.isFinite(c.start)&&c.start<=v.currentTime&&v.currentTime-c.start<12&&c.text).sort((a,b)=>b.start-a.start);
    if(rows[0]){captionText=rows[0].text;captionSource='本机字幕面板';}
  }
  const btn=document.querySelector('.ytp-subtitles-button');
  const title=document.querySelector('ytd-watch-metadata h1')?.textContent.trim()||document.title.replace(/^(?:\(\d+\) )?| - YouTube$/g,'');
  return {ready:true,title,url:location.href,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:0,paused:v.paused,ended:v.ended,rate:v.playbackRate,cc:btn?.getAttribute('aria-pressed')==='true'||captionSource==='本机字幕面板',captionText,captionSource,captionsAvailable:!!btn && !btn.hidden};
}

export function captureCaption(previous,sample,now=Date.now()) {
  const s=previous ?? {seq:0,epoch:0,entries:[],lastTime:sample.time,lastWall:now,lastText:''};
  const expected=(now-s.lastWall)/1000*Math.max(1,sample.rate||1);
  if(sample.time<s.lastTime-2 || sample.time-s.lastTime>expected+8){s.epoch++;s.entries=[];s.lastText='';}
  s.lastTime=sample.time;s.lastWall=now;
  const text=sample.captionText;
  if(text && text!==s.lastText){
    const prev=s.entries.at(-1);
    if(prev && text.startsWith(prev.text) && sample.time-prev.end<4){prev.text=text;prev.end=sample.time;}
    else s.entries.push({seq:++s.seq,start:sample.time,end:sample.time,text});
    if(s.entries.length>300)s.entries.splice(0,s.entries.length-300);
    s.lastText=text;
  }
  return s;
}

export class BrowserBridge {
  async connect(url,{tabId,pause=true}={}) {
    this.connected=false;
    this.createdWindow=!tabId;
    this.initialPause=pause;
    this.timelines=new Map();
    this.handle='companionTab_'+randomUUID().replaceAll('-','');
    this.client=new OpenCliClient();
    await this.client.connect();
    const status=await this.client.call('doctor',{});
    if(!status?.extension?.connected) throw Error('请打开 Chrome，并确认 OpenCLI 扩展已连接。');
    await this.client.js(`await browser.chrome.describe('windows.create'); await browser.chrome.describe('tabs.get'); await browser.chrome.describe('windows.remove');`);
    const created=tabId?await this.client.js(`nodeRepl.write(await browser.chrome.call('tabs.get',[${Number(tabId)}]));`):await this.client.js(`await browser.nameSession('📖 伴学'); {const w=await browser.chrome.call('windows.create',[{url:${JSON.stringify(url)},type:'normal',focused:true}]); nodeRepl.write({windowId:w.id,tabId:w.tabs[0].id});}`);
    this.windowId=created.windowId; this.tabId=created.tabId||created.id;
    // windows.create may resolve while its first tab still has an empty URL.
    const deadline=Date.now()+30000;
    while(true) {
      const tab=await this.client.js(`nodeRepl.write(await browser.chrome.call('tabs.get',[${this.tabId}]));`);
      if(tab.url?.startsWith('https://www.youtube.com/')) break;
      if(Date.now()>deadline) throw Error('视频页面尚未加载，请重试。');
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    await this.client.js(`var ${this.handle}=await browser.user.claimTab({tabId:${this.tabId}}); await ${this.handle}.observe();`);
    // Captions are the source for this version; turn them on only in our own window.
    await this.client.js(`nodeRepl.write(await ${this.handle}.evaluate(pause => {let b=document.querySelector('.ytp-subtitles-button');if(b?.getAttribute('aria-pressed')==='false') b.click();let v=document.querySelector('video');if(v&&pause)v.pause();return {hasVideo:!!v};},{arg:${JSON.stringify(pause)}}));`);
    this.connected=true;
    this.client.keepTab=String(this.tabId);
    return this.read();
  }
  async read() {
    const sample=await this.client.js(`nodeRepl.write(await ${this.handle}.evaluate(() => {const b=document.querySelector('.ytp-subtitles-button');if(b?.getAttribute('aria-pressed')==='false')b.click();return (${samplePage.toString()})();}));`);
    if(!sample?.ready)return sample;
    const id=new URL(sample.url).searchParams.get('v');
    if(id!==this.videoId){this.videoId=id;this.capture=null;this.timelineLoading=false;this.timelineAttempt=0;this.timelineError='';}
    const timeline=this.timelines.get(id);
    if(timeline){const cue=timelineCue(timeline,sample.time);sample.captionText=cue?.text||'';sample.captionSource='逐字稿同步';sample.cc=true;sample.timelineReady=true;}
    if(!timeline && sample.captionsAvailable && !this.timelineLoading && Date.now()-(this.timelineAttempt||0)>5000)void this.loadTimeline(id);
    if(this.initialPause){const paused=await this.control('pause');sample.paused=paused.paused;sample.time=paused.time;this.initialPause=false;}
    this.capture=captureCaption(this.capture,sample);
    return {...sample,timelineStatus:timeline?'ready':this.timelineLoading?'loading':this.timelineError||'pending',captionText:undefined,epoch:this.capture.epoch,entries:this.capture.entries.map(c=>({...c}))};
  }
  setTimeline(id,cues){this.timelines.set(id,cues);}
  async loadTimeline(id) {
    this.timelineLoading=true;this.timelineAttempt=Date.now();
    try {
      const cache=this.handle+'Transcript';
      const result=await this.client.js(`var ${cache}=await ${this.handle}.evaluate(async id=>{
        const player=document.querySelector('ytd-player')?.getPlayer?.()||document.querySelector('#movie_player');
        const current=()=>new URL(location.href).searchParams.get('v')===id && player?.getVideoData?.().video_id===id;
        if(!current())return {error:'video_changed'};
        const matches=value=>{try{const u=new URL(value);return u.origin==='https://www.youtube.com'&&u.pathname==='/api/timedtext'&&u.searchParams.get('v')===id;}catch{return false;}};
        let captionURL=performance.getEntriesByType('resource').filter(e=>matches(e.name)).at(-1)?.name;
        async function observeRequest(){
          let found='';const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(matches(e.name))found=e.name;});
          observer.observe({type:'resource'});
          const enabled=player.isSubtitlesOn?.();
          try{
            if(enabled)player.toggleSubtitles?.();player.toggleSubtitlesOn?.();
            const until=Date.now()+4000;while(!found&&current()&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
            return found;
          }finally{observer.disconnect();if(current()&&!enabled&&player.isSubtitlesOn?.())player.toggleSubtitles?.();}
        }
        async function download(address){
          if(!address)return null;
          const u=new URL(address);u.searchParams.set('fmt','json3');
          const response=await fetch(u,{credentials:'include',signal:AbortSignal.timeout(8000)});
          if(!response.ok)return null;const body=await response.text();
          if(!body.trim()||body.length>5000000)return null;return JSON.parse(body);
        }
        let data=captionURL?await download(captionURL):null;
        if(!data?.events){captionURL=await observeRequest();data=await download(captionURL);}
        if(!current())return {error:'video_changed'};
        if(!data?.events)return {error:'unavailable'};
        const rows=data.events.filter(e=>e.segs&&Number.isFinite(e.tStartMs)).map(e=>({start:e.tStartMs/1000,text:e.segs.map(s=>s.utf8||'').join('').replace(/\\s+/g,' ').trim()})).filter(c=>c.text);
        return {cues:rows.map((c,i)=>({...c,end:Math.max(c.start,rows[i+1]?.start??c.start+4)}))};
      },{arg:${JSON.stringify(id)}});nodeRepl.write({error:${cache}?.error,count:${cache}?.cues?.length||0});`);
      if(result?.count){
        const cues=[];for(let start=0;start<result.count;start+=200){
          const part=await this.client.js(`nodeRepl.write(${cache}.cues.slice(${start},${start+200}));`);
          if(!Array.isArray(part))throw Error('逐字稿读取未完成。');cues.push(...part);
        }
        this.timelines.set(id,cues);this.timelineError='';
      }
      else this.timelineError=result?.error||'unavailable';
    }catch{this.timelineError='unavailable';}
    finally{if(this.videoId===id)this.timelineLoading=false;}
  }
  async control(action,time) {
    if(action==='seek' && (!Number.isFinite(time)||time<0)) throw Error('时间戳无效。');
    return this.client.js(`nodeRepl.write(await ${this.handle}.evaluate(({action,time})=>{let v=document.querySelector('video');if(!v)throw Error('视频尚未加载');if(action==='seek')v.currentTime=Math.min(time,v.duration||time);if(action==='play')v.play();if(action==='pause')v.pause();return {time:v.currentTime,paused:v.paused};},{arg:${JSON.stringify({action,time})}}));`);
  }
  async close() {
    if(!this.client) return;
    try {await this.client.js(`if(typeof ${this.handle}!=='undefined') await ${this.handle}.evaluate(()=>{if(window.__lectureCompanion?.timer)clearInterval(window.__lectureCompanion.timer);delete window.__lectureCompanion;});`);} catch {}
    if(!this.connected && this.createdWindow && this.windowId)try {await this.client.js(`await browser.chrome.call('windows.remove',[${this.windowId}]);`);}catch{}
    await this.client.close();this.client=null;
  }
}
