import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeURL,captureCaption} from '../lib/browser.mjs';
import {transcriptText,validateCard,currentCard,needsSegment,scheduleReview} from '../lib/cards.mjs';
import {parseTranscript,timelineCue,sealedCues,captionLag} from '../lib/transcript.mjs';

test('课程链接只接受具体 YouTube 视频并去掉追踪参数',()=>{
  assert.deepEqual(youtubeURL('https://youtu.be/0yD3uBshJB0?t=34'),{id:'0yD3uBshJB0',url:'https://www.youtube.com/watch?v=0yD3uBshJB0'});
  for(const url of ['http://youtube.com/watch?v=0yD3uBshJB0','https://youtube.com.evil.test/watch?v=0yD3uBshJB0','file:///etc/passwd','https://www.youtube.com/playlist?list=test'])assert.throws(()=>youtubeURL(url));
});
test('滚动字幕去重时仍保留新增内容',()=>{
  assert.equal(transcriptText([{text:'a robotic manipulator'},{text:'robotic manipulator has several joints'},{text:'robotic manipulator has several joints'}]),'a robotic manipulator has several joints');
});
test('实际采样在本地累积字幕，拖动视频后单独分段',()=>{
  let state=captureCaption(null,{time:10,rate:1,captionText:'robot'},1000);
  state=captureCaption(state,{time:11,rate:1,captionText:'robot motion'},2000);
  assert.equal(state.entries.length,1);assert.equal(state.entries[0].text,'robot motion');
  state=captureCaption(state,{time:14,rate:1,captionText:'joint angles'},5000);
  assert.equal(state.entries.length,2);
  state=captureCaption(state,{time:150,rate:1,captionText:'a later topic'},6000);
  assert.equal(state.epoch,1);assert.equal(state.entries.length,1);assert.equal(state.entries[0].start,150);
});
test('跳到未观察的区间不会展示旧卡片',()=>{
  const card={start:20,end:45,createdAt:'2026-10-09T00:00:00Z'};
  assert.equal(currentCard([card],30),card);
  assert.equal(currentCard([card],300),null);
  assert.equal(currentCard([card],10),null);
});
test('信息太少和短暂播放不会提前触发总结',()=>{
  assert.equal(needsSegment([{start:0,text:'hello'}],100,0,false),false);
  const cues=[{start:0,text:'Robot motion is described by coordinates. '.repeat(16)}];
  assert.equal(needsSegment(cues,10,0,false),false);
  assert.equal(needsSegment(cues,20,0,false),true);
  assert.equal(needsSegment(cues,70,0,false),true);
  assert.equal(needsSegment(cues,70,Date.now(),false),false);
});
test('最后一行停止变化后仍可总结，不必等待下一行',()=>{
  const cues=[{seq:7,start:40,end:42,text:'one'},{seq:8,start:44,end:46,text:'two'}];
  assert.equal(sealedCues(cues,47).length,1);
  assert.equal(sealedCues(cues,49).length,2);
  assert.equal(sealedCues(cues,46,true).length,2);
  assert.equal(captionLag(cues,60),14);
});
test('逐字稿缓存只读取播放位置之前已完成的行',()=>{
  const cues=parseTranscript('Language: en\n[0:00] first\n[0:02] second\n[1:01:02] later');
  assert.equal(cues[2].start,3662);
  assert.equal(timelineCue(cues,1),null);
  assert.equal(timelineCue(cues,3).text,'first');
  assert.equal(timelineCue(cues,30),null);
  assert.equal(timelineCue(cues,3663).text,'second');
  assert.equal(timelineCue(cues,3667).text,'later');
});
const card=()=>({title:'机器人运动',summary:'关节和运动之间存在对应关系。',keyPoints:['观察关节运动'],formula:'',example:'',question:'运动如何描述？',answer:'使用坐标。',evidenceQuote:'robot motion',uncertainty:''});
test('无法在字幕中找到的原文会被移除并注明',()=>{
  const c=validateCard(card(),'we discuss robot motion today');assert.equal(c.evidenceQuote,'robot motion');
  const other=validateCard(card(),'the topic is probability');assert.equal(other.evidenceQuote,'');assert.match(other.uncertainty,/未匹配/);
  assert.throws(()=>validateCard({...card(),title:'Robot',summary:'Coordinates'},'robot motion'));
});
test('复习时间按用户记忆反馈调整',()=>{
  const now=Date.UTC(2026,9,9);
  assert.equal(new Date(scheduleReview(null,'again',now).due).getTime(),now+600000);
  assert.equal(scheduleReview(null,'good',now).interval,1);
  assert.equal(scheduleReview({interval:2},'good',now).interval,4);
  assert.equal(scheduleReview({interval:2},'easy',now).interval,6);
});
