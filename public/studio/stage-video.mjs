import * as V from './virtual-stage-core.mjs?v=bd900549f538';
// Deliberately local and deterministic: this creates an editable blocking draft, not AI geometry.
export function planStage({brief='',duration=5,shot={},assets=[]}={}){
 const text=String(brief||[shot.scene,shot.description].filter(Boolean).join('，')).slice(0,8000);
 if(!text.trim())throw Error('请填写场景、人物或运镜描述');
 const template=/街|道路|户外/.test(text)?'street':/办公|会议室/.test(text)?'office':/教室|课堂/.test(text)?'classroom':/客厅|沙发/.test(text)?'living':/产品|商品|展品/.test(text)?'product':/会场|演讲|舞台/.test(text)?'presentation':'dialogue';
 let scene=V.templateStage(template,duration),names=[...new Set([...(shot.characterNames||[]),...(shot.characters||[]).map(id=>assets.find(a=>a.id===id)?.name)].filter(Boolean))].slice(0,12);
 const count=names.length||(/三人|三个人/.test(text)?3:/两人|双人|两个人/.test(text)?2:/单人|一个人|一人|独自/.test(text)?1:scene.objects.filter(o=>o.type==='person').length);
 scene.objects=scene.objects.filter(o=>o.type!=='person');
 for(let i=0;i<count;i++)scene.objects.push({...V.createObject('person',i),name:String(names[i]||'人物 '+(i+1)).slice(0,120),x:(i-(count-1)/2)*2,z:1});
 const camera=String(shot.camera||'')+' '+text;
 if(/环绕|绕拍/.test(camera))scene=V.motionPreset(scene,'orbit');
 else if(/横移|跟拍|穿越/.test(camera))scene=V.motionPreset(scene,'cross');
 else if(/推进|推近/.test(camera))scene=V.motionPreset(scene,'push');
 else if(/拉远|拉镜/.test(camera)){scene=V.motionPreset(scene,'push');const [a,b]=scene.keyframes;[a.x,b.x]=[b.x,a.x];[a.z,b.z]=[b.z,a.z]}
 else if(/固定/.test(camera)){const a=scene.keyframes[0];scene.keyframes=scene.keyframes.map(k=>({...a,id:k.id,time:k.time}))}
 if(/夜|晚上/.test(text))scene.lighting='night';else if(/暖|黄昏/.test(text))scene.lighting='warm';
 for(const k of scene.keyframes){if(/俯拍/.test(shot.angle||text))k.y=5;if(/仰拍/.test(shot.angle||text))k.y=.6;const focal=Number(shot.focalLength);if(focal>=12&&focal<=135)k.focal=focal;else if(/特写|近景/.test(shot.size||''))k.focal=85;}
 const actor=scene.objects.find(o=>o.type==='person');if(actor){if(/行走|走向|走过|走进|跟拍/.test(text))V.setActorMotion(scene,actor.id,'walk');else if(/转身/.test(text))V.setActorMotion(scene,actor.id,'turn')}
 if(/斯坦尼康|steadicam/i.test(camera)&&actor){if(!actor.motionKeys)V.setActorMotion(scene,actor.id,'walk');V.generateSteadicam(scene,actor.id);}
 return {scene:V.normalizeStage(scene),brief:text,template};
}
const ratioSize=ratio=>ratio==='9:16'?[720,1280]:ratio==='1:1'?[960,960]:[1280,720];
// Store exact scene JSON (rather than a weak hash) so edited motion cannot silently reuse old frames.
export function signature(scene,ratio){return JSON.stringify({scene:V.normalizeStage(scene),ratio})}
export function prepareBundle({scene,ratio,frames,video},uid=()=>crypto.randomUUID()){
 scene=V.normalizeStage(scene);if(!['16:9','9:16','1:1'].includes(ratio))throw Error('白模画幅无效');
 const [width,height]=ratioSize(ratio);
 if(!Array.isArray(frames)||frames.length!==2||frames.some(f=>!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(f.src||'')||f.width!==width||f.height!==height))throw Error('白模首尾帧不完整，请重新生成');
 if(video&&(!/^data:video\/webm(?:;[^,]*)?;base64,[A-Za-z0-9+/]+=*$/.test(video.src||'')||Math.abs(video.duration-scene.duration)>.001||video.width!==width||video.height!==height))throw Error('白模预演视频与片场不一致');
 const assets=frames.map((f,i)=>({...f,id:uid(),kind:'image',type:'分镜',name:'白模'+(i?'尾帧':'首帧')+'.png',created:Date.now(),locked:false,tags:'虚拟片场,视频参考',description:'白模空间与运镜参考；成片角色外观以角色参考图为准'}));
 if(video)assets.push({...video,id:uid(),kind:'video',type:'视频',name:'白模运镜参考.webm',created:Date.now(),locked:false,tags:'虚拟片场,预演,视频参考',description:'白模预演参考，非AI成片'});
 return {scene,assets,binding:{signature:signature(scene,ratio),ratio,duration:scene.duration,firstFrame:assets[0].id,lastFrame:assets[1].id,referenceVideo:video?assets[2].id:''}};
}
export function mediaRequest(target,scene,ratio,assets){
 const b=target?.stageVideo;if(!b)return {assetIds:[],referenceVideos:[],binding:null};
 if(!scene||b.signature!==signature(scene,ratio))throw Error('白模场景、时长或画幅已改变，请重新点击“带入视频生成”更新参考');
 const ids=[b.firstFrame,b.lastFrame,b.referenceVideo].filter(Boolean);
 for(const id of ids){const a=assets.find(a=>a.id===id),kind=id===b.referenceVideo?'video':'image';if(!a?.src||a.kind!==kind)throw Error('白模参考素材已失效，请重新生成参考')}
 if(target.firstFrame!==b.firstFrame||target.lastFrame!==b.lastFrame)throw Error('首尾帧已更换，请重新生成白模参考，或取消应用片场');
 return {assetIds:ids,referenceVideos:b.referenceVideo?[b.referenceVideo]:[],binding:structuredClone(b)};
}
export function taskMedia(project){
 const p=project,s=p.settings,ratio=s.videoRatio||'16:9',scene=s.virtualStage?V.fitDuration(s.virtualStage,Number(s.videoDuration)||5):null;
 const overall=s.videoSequence?{assetIds:[],referenceVideos:[],binding:null}:mediaRequest(s,scene,ratio,p.assets),shots=[];
 if(s.videoSequence)for(const shot of s.videoShots||[]){const data=mediaRequest(shot,shot.virtualStage?V.fitDuration(shot.virtualStage,Number(shot.duration)||5):null,ratio,p.assets);shots.push({id:shot.id,...data})}
 return {assetIds:[...new Set([...overall.assetIds,...shots.flatMap(s=>s.assetIds)])],referenceVideos:[...new Set([...overall.referenceVideos,...shots.flatMap(s=>s.referenceVideos)])],overall:overall.binding,shots:shots.map(s=>({id:s.id,stageVideo:s.binding}))};
}
export function stageLanguage(language,enabled){if(!enabled)return language;return {params:{...language.params,camera:'虚拟片场轨迹',angle:'虚拟片场机位',focalLength:'',size:'虚拟片场取景'},prompt:language.prompt.split('\n').filter(line=>! /^(运镜|机位|焦距|景别)：/.test(line)).join('\n')+'\n景别、机位、焦距及运镜以白模片场与参考视频为准。白模仅约束空间和运动；成片恢复角色、材质与视觉风格，不保留灰色模型外观。'}}
