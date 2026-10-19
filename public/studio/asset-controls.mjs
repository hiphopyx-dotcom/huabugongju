export function removeReferences(p,id){
 p.assets=p.assets.filter(a=>a.id!==id);
 for(const n of p.nodes||[]){n.assetIds=(n.assetIds||[]).filter(v=>v!==id);if(n.resultAssetId===id)n.resultAssetId='';for(const k of ['firstFrame','lastFrame'])if(n.params?.[k]===id)n.params[k]=''}
 for(const s of p.shots||[]){for(const k of ['assetId','reverseAssetId','otsFrom','otsTo','firstFrame','lastFrame'])if(s[k]===id)s[k]='';for(const k of ['characters','locations','props','reverseLocations'])if(Array.isArray(s[k]))s[k]=s[k].filter(v=>v!==id);delete s['emotion_'+id]}
 p.clips=(p.clips||[]).filter(c=>c.assetId!==id);
 for(const t of p.tasks||[])if(t.resultAssetId===id){t.resultAssetId='';t.status='blocked'}
 if(p.settings){p.settings.videoRefs=(p.settings.videoRefs||[]).filter(v=>v!==id);for(const k of ['firstFrame','lastFrame'])if(p.settings[k]===id)p.settings[k]=''}
}
export function applyControls(p,rules){
 let changed=false;p.adminAssetControls||={};p.adminAssetTrash||={};
 for(const r of rules){const old=p.adminAssetControls[r.id];if(!old||Number(old.revision)!==Number(r.admin_revision))changed=true;if(old&&Number(old.revision)>Number(r.admin_revision))continue;
  let a=p.assets.find(a=>a.id===r.id);
  if(r.admin_deleted){if(a){p.adminAssetTrash[r.id]=structuredClone(a);removeReferences(p,r.id);changed=true}p.adminAssetControls[r.id]={revision:Number(r.admin_revision),deleted:true};continue}
  if(!a&&p.adminAssetTrash[r.id]){a=p.adminAssetTrash[r.id];p.assets.push(a);delete p.adminAssetTrash[r.id];changed=true}
  if(!a&&r.admin_locked&&old?.snapshot){a=structuredClone(old.snapshot);p.assets.push(a);changed=true}
  if(!a){p.adminAssetControls[r.id]={revision:Number(r.admin_revision),locked:!!r.admin_locked};continue}
  const before=JSON.stringify(a);a.adminLocked=!!r.admin_locked;
  // Use the recorded server metadata; preserve the original local media bytes.
  if(r.admin_locked){a.name=r.name;const frozen=old?.snapshot;if(frozen){const src=frozen.src;Object.assign(a,structuredClone(frozen),{adminLocked:true,src})}}
  p.adminAssetControls[r.id]={revision:Number(r.admin_revision),locked:!!r.admin_locked,...(r.admin_locked?{snapshot:structuredClone(a)}:{})};
  changed ||= before!==JSON.stringify(a);
 }
 return changed;
}
export function enforceControls(p){
 let changed=false;
 for(const [id,rule] of Object.entries(p.adminAssetControls||{})){
  const a=p.assets.find(a=>a.id===id);
  if(rule.deleted){if(a){removeReferences(p,id);changed=true}}
  else if(rule.locked&&rule.snapshot){if(!a){p.assets.push(structuredClone(rule.snapshot));changed=true}else if(JSON.stringify(a)!==JSON.stringify(rule.snapshot)){Object.keys(a).forEach(k=>delete a[k]);Object.assign(a,structuredClone(rule.snapshot));changed=true}}
 }
 return changed;
}
