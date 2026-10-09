const frame=document.querySelector('#companion'),notice=document.querySelector('#notice'),message=document.querySelector('#message'),retry=document.querySelector('#retry');
let opened=false;
function show(value){
 if(value?.phase==='ready'){
   if(!opened){frame.src='http://127.0.0.1:4318/?extension=1';opened=true;}
   frame.hidden=false;notice.hidden=true;return;
 }
 if(value?.phase==='connecting'){if(opened)return;message.textContent=value.message;retry.hidden=true;return;}
 if(['choose','error'].includes(value?.phase)){
   notice.hidden=false;frame.hidden=true;message.textContent=value.message;retry.hidden=false;
 }
}
chrome.storage.session.onChanged.addListener(changes=>{if(changes.companionStatus)show(changes.companionStatus.newValue);});
retry.onclick=()=>chrome.runtime.sendMessage({type:'retry'});
const initial=(await chrome.storage.session.get('companionStatus')).companionStatus;
if(initial)show(initial);
else {message.textContent='打开 YouTube 视频，再点右上角「伴学」即可开始。';retry.hidden=false;}
// A restored side panel should still work after the local service was stopped.
if(initial?.phase==='ready'){
 const result=await chrome.runtime.sendMessage({type:'ensure-service'});
 if(result.ok){frame.src='http://127.0.0.1:4318/?extension=1';}else show({phase:'error',message:result.error});
}
