// Video-facing script metadata. Keep the original still-image description and
// storyboard reference assets unchanged; actions can be edited independently.
const text=v=>typeof v==='string'?v:String(v??'');
export const FIELDS=Object.freeze([
 ['videoAction','画面与动作'],
 ['dialogue','台词 / 声音'],
 ['subtitle','字幕'],
 ['sourceText','对应剧本原文']
]);
export function shotScript(shot,index){
 return {shotId:shot.id,order:index+1,episode:text(shot.episode),scene:text(shot.scene),
  action:text(shot.videoAction??shot.description),
  dialogue:text(shot.dialogue),subtitle:text(shot.subtitle),sourceText:text(shot.sourceText)};
}
export function collectVideoScript(project,{sourcePair=null,allowPair=false}={}){
 const shots=project.shots||[];
 let selected=[];
 if(allowPair&&sourcePair){
  const i=shots.findIndex(s=>s.id===sourcePair.fromId);
  if(i>=0&&shots[i+1]?.id===sourcePair.toId)selected=[i,i+1];
 }
 if(!selected.length){const i=shots.findIndex(s=>s.id===project.settings?.videoScriptShotId);if(i>=0)selected=[i];}
 if(!selected.length&&shots.length)selected=[0];
 if(!selected.length)return {shots:[],prompt:''};
 const result=selected.map(i=>shotScript(shots[i],i));
 const prompt=result.map((s,i)=>[
  `【视频${result.length===2?(i===0?'首帧':'尾帧'):'镜头'}${s.order} · ${s.episode} ${s.scene}】`,
  s.action&&`画面与动作：${s.action}`,
  s.dialogue&&`台词 / 声音：${s.dialogue}`,
  s.subtitle&&`字幕：${s.subtitle}`,
  s.sourceText&&`对应剧本原文（叙事参考，不作为画面文字）：${s.sourceText}`
 ].filter(Boolean).join('\n')).join('\n\n');
 return {shots:result,prompt};
}
