// Lightweight handoffs: writing -> independent images -> composite stills -> video.
// Every stage uses the existing project's IDs and media; never duplicate image bytes.
export const STAGES=Object.freeze([
 {id:'writing',label:'剧本生成',hint:'创作或修改剧本'},
 {id:'image',label:'图片生成',hint:'导入剧本，拆人物 / 场景 / 道具，制作基础图'},
 {id:'shots',label:'分镜融合',hint:'将素材合成一张静态镜头画面'},
 {id:'video',label:'视频生成',hint:'让前后两张分镜产生连续运动'}
]);
const BASIC_TYPES=Object.freeze({角色:'characters',场景:'locations',道具:'props'});
export function basicImages(project){return (project.assets||[]).filter(a=>a.kind==='image'&&BASIC_TYPES[a.type]&&!a.adminDeleted&&!project.adminAssetControls?.[a.id]?.deleted)}
export function imageCounts(project){const assets=basicImages(project);return Object.fromEntries(Object.keys(BASIC_TYPES).map(t=>[t,assets.filter(a=>a.type===t).length]));}
export function bindComposition(project,shotId,ids){
 const shot=project.shots?.find(s=>s.id===shotId);
 if(!shot)throw Error('目标分镜不存在');
 if(!Array.isArray(ids)||ids.length>25||ids.some(id=>typeof id!=='string'))throw Error('基础图片列表无效');
 const chosen=[...new Set(ids)],assets=basicImages(project),byId=new Map(assets.map(a=>[a.id,a]));
 if(chosen.some(id=>!byId.has(id)))throw Error('图片不属于当前项目，或已被管理员禁用');
 const next=Object.fromEntries(Object.entries(BASIC_TYPES).map(([type,key])=>[key,chosen.filter(id=>byId.get(id).type===type)]));
 for(const [key,values] of Object.entries(next))shot[key]=values;
 return next;
}
export function stillPairs(project){
 const shots=project.shots||[];
 return shots.slice(0,-1).map((from,i)=>{
  const to=shots[i+1],a=project.assets.find(a=>a.id===from.assetId&&a.kind==='image'&&!project.adminAssetControls?.[a.id]?.deleted),b=project.assets.find(a=>a.id===to.assetId&&a.kind==='image'&&!project.adminAssetControls?.[a.id]?.deleted);
  return {id:`${from.id}:${to.id}`,fromId:from.id,toId:to.id,index:i,fromAsset:a||null,toAsset:b||null,
   ready:!!(a&&b),fromLabel:from.description||`分镜 ${i+1}`,toLabel:to.description||`分镜 ${i+2}`};
 });
}
export function videoBetweenStills(project,fromId,toId){
 const pair=stillPairs(project).find(p=>p.fromId===fromId&&p.toId===toId);
 if(!pair)throw Error('只能选择本项目按顺序排列的相邻分镜');
 if(!pair.ready)throw Error('请先完成并绑定这两张静态分镜图片');
 const from=project.shots[pair.index],to=project.shots[pair.index+1];
 return {fromId,toId,firstFrame:pair.fromAsset.id,lastFrame:pair.toAsset.id,
  ratio:to.ratio||from.ratio||project.settings.ratio||'16:9',
  duration:Math.max(1,Math.min(60,Number(project.settings.videoDuration)||5)),
  prompt:`由上一张分镜自然运动至下一张分镜；起点：${from.description||from.scene}；终点：${to.description||to.scene}。保持角色身份、服装、道具、场景方位和画面连续，避免突然换脸、跳轴或新增人物。`};
}
