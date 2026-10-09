let app=null,view='watch',csrf='',renderKey='',notesKey='',reviewKey='',reviewIndex=0,revealed=false;
const $=s=>document.querySelector(s);
const extensionMode=new URLSearchParams(location.search).get('extension')==='1';
document.body.classList.toggle('extension-mode',extensionMode);
if(extensionMode)$('.brand').href='/?extension=1';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=t=>`${String(Math.floor((t||0)/60)).padStart(2,'0')}:${String(Math.floor((t||0)%60)).padStart(2,'0')}`;
function toast(text){$('#toast').textContent=text;$('#toast').classList.remove('hidden');setTimeout(()=>$('#toast').classList.add('hidden'),2600);}
async function api(path,data={}){
 const send=()=>fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':csrf},body:JSON.stringify(data)});
 let res=await send();
 // A service restart changes the page token while the restored panel stays open.
 if(res.status===403){csrf=(await fetch('/api/bootstrap').then(r=>r.json())).token;res=await send();}
 const result=await res.json();if(!res.ok)throw Error(result.error||'操作未完成。');return result;
}
async function action(fn){try{await fn();}catch(e){toast(e.message);}}
function dueCards(){return (app?.course?.cards??[]).filter(c=>c.saved&&(!c.review||Date.parse(c.review.due)<=Date.now()));}
function cardHTML(c,notes=false){return `<article class="concept-card" data-id="${escape(c.id)}"><div class="card-meta"><span class="card-tag">${c.origin==='recovered'?'已看部分 · 字幕补录':'知识点小结'}</span><span>${time(c.start)} — ${time(c.end)}</span></div><h2>${escape(c.title)}</h2><p class="card-summary">${escape(c.summary)}</p><ul class="key-points">${c.keyPoints.map(p=>`<li>${escape(p)}</li>`).join('')}</ul>${c.formula?`<div class="detail-section"><h4>公式与符号</h4><div class="formula">${escape(c.formula)}</div></div>`:''}${c.example?`<div class="detail-section"><h4>辅助理解 · AI 补充</h4><p>${escape(c.example)}</p></div>`:''}<div class="detail-section"><h4>试着解释</h4><p>${escape(c.question)}</p></div>${c.evidenceQuote?`<details class="detail-section"><summary class="source-button">查看字幕原文</summary><blockquote>${escape(c.evidenceQuote)}</blockquote></details>`:''}${c.uncertainty?`<div class="uncertainty">待核对 · ${escape(c.uncertainty)}</div>`:''}<div class="card-actions"><button class="save-button ${c.saved?'saved':''}" data-save="${escape(c.id)}">${c.saved?'✓ 已存入笔记':'＋ 保存到笔记'}</button><button class="source-button" data-seek="${c.start}">↗ 回到这段讲解</button></div>${notes?`<textarea class="note-input" data-note="${escape(c.id)}" placeholder="写下自己的理解，或一个想进一步弄懂的问题…">${escape(c.note)}</textarea><button class="note-save" data-note-save="${escape(c.id)}">保存我的笔记</button>`:''}</article>`;}
function render(state){const previousId=app?.course?.id;app=state;const r=state.runtime,c=state.course,p=r.playback;
 if(c && previousId!==c.id && document.activeElement.id!=='video-url')$('#video-url').value=c.url;
 $('#codex-dot').classList.toggle('connected',r.mcpConnected);$('#codex-label').textContent=r.mcpConnected?'播放同步已接通':r.codexReady?'Codex 已登录':'Codex 尚未登录';
 $('#saved-count').textContent=c?.cards.filter(x=>x.saved).length||0;$('#due-count').textContent=dueCards().length;
 $('#library').innerHTML=state.courses.length?state.courses.map(x=>`<button class="library-course ${x.id===c?.id?'selected':''}" data-course="${escape(x.id)}">${escape(x.title)}<small>${x.cardCount} 个知识点 · 看至 ${time(x.progress)}</small></button>`).join(''):'<div class="empty-small">你的课程会留在这里。</div>';
 const picker=$('#course-picker');if(document.activeElement!==picker){picker.innerHTML=state.courses.length?state.courses.map(x=>`<option value="${escape(x.id)}">${escape(x.title)}</option>`).join(''):'<option>尚无课程笔记</option>';picker.value=c?.id||'';}
 const phases={idle:'等待开始',connecting:'正在连接',loading:'等待播放器',paused:'已暂停',watching:'正在陪看',error:'连接中断'};
 $('#phase').textContent=phases[r.phase]||r.phase;$('#course-title').textContent=c?.title||'从你感兴趣的一堂课开始';$('#player-message').textContent=r.message;
 $('#player-headline').textContent=extensionMode?(['watching','paused'].includes(r.phase)?'正在跟随当前视频':'在视频页点击伴学即可连接'):(['watching','paused'].includes(r.phase)?'已连接独立播放窗口':'课程在独立窗口播放');
 $('#time-label').textContent=`${time(p?.time??c?.progress)} / ${time(p?.duration)}`;$('#progress-fill').style.width=`${p?.duration?Math.min(100,p.time/p.duration*100):0}%`;
 $('#play-button').disabled=!['watching','paused'].includes(r.phase);$('#play-button').textContent=!p||p.paused?'播放':'暂停';
 $('#stop-button').disabled=['idle','error'].includes(r.phase);$('#summarize-button').disabled=!p||r.generating||!r.captionCount;
 $('#connect-button').disabled=r.phase==='connecting';$('#connect-button').innerHTML=r.phase==='connecting'?'正在打开…':'开始陪看 <span>↗</span>';
 const elapsed=r.generationStartedAt?Math.max(0,Math.floor((Date.now()-Date.parse(r.generationStartedAt))/1000)):0;
 const readStatus=r.lastCaptionTime===null?'等待讲解':`字幕同步至 ${time(r.lastCaptionTime)} · ${p?.captionSource||'字幕'}`;
 $('#card-count').textContent=`${c?.cards.length||0} 张卡片`;$('#generation-status').textContent=r.generating?`正在整理中文小结 · ${elapsed} 秒 · ${readStatus}`:readStatus+(r.lastGenerationMs?` · 上次生成 ${Math.round(r.lastGenerationMs/1000)} 秒`:'');
 $('#error-banner').textContent=r.error;$('#error-banner').classList.toggle('hidden',!r.error);
 const key=JSON.stringify([c?.id,c?.cards.map(x=>[x.id,x.saved]),state.currentCard?.id,r.generating,!!r.captionCount]);
 if(key!==renderKey){renderKey=key;
  $('#timeline').innerHTML=c?.cards.length?c.cards.slice().reverse().map(x=>`<div class="timeline-item ${x.id===state.currentCard?.id?'current':''}" role="button" tabindex="0" data-open="${escape(x.id)}"><div class="timeline-time">${time(x.start)}</div><div><div class="timeline-title">${escape(x.title)}</div><div class="timeline-desc">${escape(x.summary.slice(0,55))}… ${x.saved?'· 已保存':''}</div></div></div>`).join(''):'<div class="empty-small">第一张小结出现后，你的学习路线会从这里展开。</div>';
  if(state.currentCard){$('#current-card').className='';$('#current-card').innerHTML=cardHTML(state.currentCard);}
  else {$('#current-card').className='concept-card empty-card';$('#current-card').innerHTML=`<div class="empty-illustration"><span>✧</span><span>▤</span><span>✧</span></div><h2>${r.generating?'正在把讲解，整理成理解。':'留一点空间，给新的理解。'}</h2><p>${r.captionCount?'这一段的字幕正在积累。积累足够讲解后会自动生成，也可以点“总结刚刚这一段”。':'积累一小段讲解后，中文小结会出现在这里。请先打开视频的 CC 字幕。'}</p><div class="card-placeholder"><i></i><i></i><i></i></div>`;}
 }
 $('#current-label').textContent=state.currentKind==='recent'?'最近生成的小结':'此刻的知识点';
 if(view==='notes')renderNotes();if(view==='review'&&!revealed)renderReview();
}
function switchView(v){view=v;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==v+'-view'));document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#breadcrumb').textContent='学习空间 / '+({watch:'一起看',notes:'我的笔记',review:'温故知新'}[v]);if(v==='notes')renderNotes(true);if(v==='review'){reviewIndex=0;revealed=false;renderReview();}}
function renderNotes(force=false){const query=$('#search').value.toLowerCase(),all=$('#all-cards').checked;const cards=(app?.course?.cards??[]).filter(c=>(all||c.saved)&&[c.title,c.summary,c.note,...c.keyPoints].join(' ').toLowerCase().includes(query));const key=JSON.stringify([cards,query,all]);if(!force&&notesKey===key)return;notesKey=key;$('#notes-grid').innerHTML=cards.length?cards.map(c=>cardHTML(c,true)).join(''):'<div class="empty-small">保存一张知识点卡片，你的笔记就从这里开始。也可以勾选“显示全部卡片”。</div>';}
function renderReview(){const cards=dueCards();const key=JSON.stringify([cards.map(c=>[c.id,c.question,c.answer]),reviewIndex,revealed]);if(key===reviewKey)return;reviewKey=key;const c=cards[reviewIndex];if(!c){$('#review-area').innerHTML='<div class="review-complete"><span>✳</span><h2>今天的回顾，就到这里。</h2><p>保存的卡片会按你的熟悉程度安排下一次复习。<br>继续学习，也给记忆一点时间。</p></div>';return;}$('#review-area').innerHTML=`<article class="review-card"><div class="review-progress">今天待复习 ${cards.length} 个知识点 · 来源 ${time(c.start)}</div><span class="card-tag">${escape(c.title)}</span><h2>${escape(c.question)}</h2>${revealed?`<div class="review-answer">${escape(c.answer)}</div><div class="rating-row"><button data-rating="again" data-id="${escape(c.id)}">还没记住 · 10 分钟</button><button data-rating="hard" data-id="${escape(c.id)}">有点模糊 · 明天</button><button data-rating="good" data-id="${escape(c.id)}">记住了</button><button data-rating="easy" data-id="${escape(c.id)}">很熟悉</button></div>`:'<button id="reveal" class="primary">想好了，看看答案</button>'}<div class="card-actions"><button class="source-button" data-seek="${c.start}">↗ 回看老师的讲解</button></div></article>`;}
$('#connect-form').addEventListener('submit',e=>{e.preventDefault();action(()=>api('start',{url:$('#video-url').value}));});
$('#play-button').onclick=()=>action(()=>api('control',{action:app.runtime.playback?.paused?'play':'pause'}));
$('#summarize-button').onclick=()=>action(()=>api('summarize'));
$('#stop-button').onclick=()=>action(()=>api('stop'));
$('#export').onclick=()=>{if(!app.course)return toast('先保存一段课程笔记。');location.href='/api/export?id='+encodeURIComponent(app.course.id);};
$('#search').oninput=()=>renderNotes(true);$('#all-cards').onchange=()=>renderNotes(true);
$('#course-picker').onchange=e=>action(()=>api('select',{id:e.target.value}));
document.addEventListener('click',e=>{const b=e.target.closest('button,[data-open]');if(!b)return;
 if(b.dataset.view)switchView(b.dataset.view);
 if(b.dataset.course)action(()=>api('select',{id:b.dataset.course}));
 if(b.dataset.save)action(async()=>{const c=app.course.cards.find(x=>x.id===b.dataset.save);await api('card',{courseId:app.course.id,id:c.id,saved:!c.saved});toast(c.saved?'已取消收藏':'已保存到笔记');});
 if(b.dataset.seek!==undefined)action(async()=>{if(['idle','error'].includes(app.runtime.phase)){window.open(app.course.url+'&t='+Math.floor(Number(b.dataset.seek))+'s','_blank','noopener');return;}await api('control',{action:'seek',time:Number(b.dataset.seek)});});
 if(b.dataset.open){const c=app.course.cards.find(x=>x.id===b.dataset.open);$('#current-card').className='';$('#current-card').innerHTML=cardHTML(c);$('#current-label').textContent='回顾这个知识点';}
 if(b.dataset.noteSave)action(async()=>{const area=document.querySelector(`[data-note="${b.dataset.noteSave}"]`);await api('card',{courseId:app.course.id,id:b.dataset.noteSave,note:area.value});toast('自己的理解，已记下。');});
 if(b.id==='reveal'){revealed=true;renderReview();}
 if(b.dataset.rating)action(async()=>{await api('card',{courseId:app.course.id,id:b.dataset.id,rating:b.dataset.rating});revealed=false;reviewIndex=0;renderReview();});
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset.open)e.target.click();});
try{csrf=(await fetch('/api/bootstrap').then(r=>r.json())).token;render(await fetch('/api/state').then(r=>r.json()));const events=new EventSource('/api/events');events.onmessage=e=>render(JSON.parse(e.data));events.onerror=()=>{if(app){app.runtime.error='伴学服务暂时断开，正在尝试恢复。';render(app);}};}catch{toast('本地伴学服务尚未启动。');}
