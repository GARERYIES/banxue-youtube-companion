export function parseTranscript(text) {
  const cues=[];
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\[(\d+(?::\d{1,2}){1,2})\]\s*(.+)$/);
    if(match)cues.push({start:match[1].split(':').map(Number).reduce((a,b)=>a*60+b,0),text:match[2].trim()});
  }
  return cues.map((c,i)=>({...c,end:cues[i+1]?.start??c.start+4}));
}
export function timelineCue(cues,time) {
  // Completed lines only: cached future text is never sent to the model.
  return cues.filter(c=>c.end<=time && time-c.end<15).at(-1)??null;
}
export function sealedCues(cues,time,paused=false) {
  return cues.filter((c,i)=>paused || i<cues.length-1 || time-c.end>=3);
}
export function captionLag(cues,time) {
  return cues.length?Math.max(0,time-cues.at(-1).end):time;
}
