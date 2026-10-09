export const cardSchema = {
  type:'object',additionalProperties:false,properties:{
    title:{type:'string'},summary:{type:'string'},keyPoints:{type:'array',items:{type:'string'}},
    formula:{type:'string'},example:{type:'string'},question:{type:'string'},answer:{type:'string'},
    evidenceQuote:{type:'string'},uncertainty:{type:'string'}
  },required:['title','summary','keyPoints','formula','example','question','answer','evidenceQuote','uncertainty']
};
export const normalize = text => text.replace(/\s+/g,' ').trim();
export function transcriptText(cues) {
  let out='';
  for(const c of cues) {
    let t=normalize(c.text); if(!t)continue;
    if(out.endsWith(t))continue;
    let overlap=0; const max=Math.min(300,out.length,t.length);
    for(let n=max;n>=8;n--) if(out.endsWith(t.slice(0,n))) {overlap=n;break;}
    out+=(out && !overlap?' ':'')+t.slice(overlap);
  }
  return out;
}
export function validateCard(card,text) {
  if(!card || typeof card!=='object')throw Error('总结格式无效。');
  for(const key of cardSchema.required.filter(k=>k!=='keyPoints')) if(typeof card[key]!=='string'||card[key].length>5000)throw Error('总结内容格式无效。');
  if(!/[\u4e00-\u9fff]/.test(card.title+card.summary))throw Error('总结没有使用中文。');
  if(!Array.isArray(card.keyPoints)||card.keyPoints.length>8||card.keyPoints.some(x=>typeof x!=='string'||x.length>1000))throw Error('知识点格式无效。');
  const quote=normalize(card.evidenceQuote);
  if(quote && !normalize(text).toLowerCase().includes(quote.toLowerCase())) {
    card.evidenceQuote='';card.uncertainty=[card.uncertainty,'原文摘录未匹配，已移除。'].filter(Boolean).join(' ');
  }
  return card;
}
export function currentCard(cards,time) {
  // A jump into an unobserved gap must not display an unrelated earlier card.
  return cards.filter(c=>c.start<=time && c.end+12>=time).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
export function needsSegment(cues,time,lastRequest,paused,force=false) {
  const text=transcriptText(cues);
  if(text.length<80)return false;
  if(force)return true;
  if(Date.now()-lastRequest<15000)return false;
  return text.length>=140 && (time-cues[0].start>=20 || paused) || time-cues[0].start>=35;
}
export function scheduleReview(previous,rating,now=Date.now()) {
  const interval=rating==='again'?0:rating==='hard'?1:rating==='easy'?Math.max(3,(previous?.interval||1)*3):Math.max(1,(previous?.interval||0)*2);
  return {interval,due:new Date(now+(rating==='again'?600000:interval*86400000)).toISOString(),lastReviewed:new Date(now).toISOString(),rating};
}
