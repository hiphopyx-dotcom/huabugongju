// A reference is an ordinary project-owned image asset with an explicit library scope.
// Store bytes in assets[] once; storyboard and backups only keep asset IDs.
export const REFERENCE_ROLES=Object.freeze({characters:'角色',locations:'场景',props:'道具',reverseLocations:'场景'});
export const isReferenceAsset=asset=>asset?.kind==='image'&&asset.library==='reference';
export const referenceAssets=(project,role='')=>(project.assets||[]).filter(a=>isReferenceAsset(a)&&(!role||a.referenceRole===role));
export function assetsForShelf(project,filter='all',search=''){
  const words=String(search||'').toLowerCase();
  return (project.assets||[]).filter(a=>{
    if(filter==='reference'?!isReferenceAsset(a):isReferenceAsset(a)||filter!=='all'&&a.type!==filter&&a.kind!==filter)return false;
    return !words||[a.name,a.tags,a.description,a.referenceRole].join(' ').toLowerCase().includes(words);
  });
}
export function referenceChoices(project,role){
  return (project.assets||[]).filter(a=>a.kind==='image'&&a.type===role&&(!isReferenceAsset(a)||a.referenceRole===role));
}
export function attachReferences(project,shotId,key,files,uid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()){
  const role=REFERENCE_ROLES[key];
  if(!role)throw Error('参考图用途无效');
  const shot=project.shots.find(s=>s.id===shotId);
  if(!shot)throw Error('分镜已删除，请重新选择镜头');
  if(!Array.isArray(files)||!files.length||files.length>6)throw Error('一次上传1—6张图片');
  for(const f of files){
    if(!f||typeof f.name!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(f.src||'')||!Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width<1||f.height<1)throw Error('参考图不是有效的PNG/JPEG/WebP图片');
  }
  const assets=files.map(f=>({id:uid(),name:f.name,kind:'image',type:role,library:'reference',referenceRole:role,
    src:f.src,width:f.width,height:f.height,created:now(),locked:false,tags:'参考库',description:''}));
  project.assets.push(...assets);
  shot[key]=[...new Set([...(shot[key]||[]),...assets.map(a=>a.id)])];
  return assets;
}
export function projectBackup(project){
  const snapshot=structuredClone(project);
  // The export format is deliberately unchanged. Each image's data URL travels
  // inside the same project JSON, so backup/duplicate/import retain the reference library.
  for(const asset of referenceAssets(snapshot))if(!asset.src?.startsWith('data:image/'))throw Error('参考库存在未包含原图的素材，无法完成备份');
  return snapshot;
}
export function attachStillResult(project,shotId,file,uid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()){
 const shot=project.shots.find(s=>s.id===shotId);
 if(!shot)throw Error('分镜已删除，请重新选择镜头');
 if(!file||typeof file.name!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(file.src||'')||!Number.isSafeInteger(file.width)||!Number.isSafeInteger(file.height)||file.width<1||file.height<1)throw Error('生成结果必须是有效的静态PNG/JPEG/WebP图片');
 const asset={id:uid(),name:file.name,kind:'image',type:'分镜',src:file.src,width:file.width,height:file.height,created:now(),locked:false,tags:'静态分镜',description:shot.description||''};
 project.assets.push(asset);
 shot.assetId=asset.id;
 return asset;
}
