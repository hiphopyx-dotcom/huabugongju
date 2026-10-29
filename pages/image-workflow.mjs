// Pure creative workflow helpers. No network, account, billing, or generation side effects.
import {IMAGE_WORKSHOP_CATEGORIES, buildImageWorkshopPrompt} from './image-workshop-core.mjs?v=b7e1c04a9d23';
import * as SB from './storyboard.mjs?v=b7e1c04a9d23';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = value => { if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value; };
const text = value => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const list = value => Array.isArray(value) ? value : [];
const nameKey = value => text(value).trim().normalize('NFC');
const categoryOf = value => IMAGE_WORKSHOP_CATEGORIES.find(c => c.id === value || c.label === value)?.id || '';

export const IMAGE_TABS = freeze(IMAGE_WORKSHOP_CATEGORIES.map(c => ({...c})));
export const IMAGE_SLOTS = freeze({
 characters: [
  {id:'front',label:'正面',ratio:'3:4'}, {id:'side',label:'侧面',ratio:'3:4'}, {id:'back',label:'背面',ratio:'3:4'},
  {id:'expr_smile',label:'微笑',ratio:'1:1'}, {id:'expr_anger',label:'愤怒',ratio:'1:1'},
  {id:'expr_stern',label:'严肃',ratio:'1:1'}, {id:'expr_cry',label:'哭泣',ratio:'1:1'},
  {id:'expr_sad',label:'悲伤',ratio:'1:1'}, {id:'expr_fear',label:'恐惧',ratio:'1:1'},
  {id:'expr_provoke',label:'挑衅',ratio:'1:1'}, {id:'expr_stare',label:'凝视',ratio:'1:1'},
 ],
 locations: [
  {id:'plan',label:'俯视白模 · 鸟瞰',ratio:'1:1'}, {id:'view_n',label:'北机位 · 朝南拍',ratio:'16:9'},
  {id:'view_w',label:'西机位 · 朝东拍',ratio:'16:9'}, {id:'view_e',label:'东机位 · 朝西拍',ratio:'16:9'},
  {id:'view_s',label:'南机位 · 朝北拍',ratio:'16:9'},
 ],
 props: [{id:'hero',label:'道具主图',ratio:'1:1'}],
 storyboard: [{id:'frame',label:'主机位',ratio:'16:9'},{id:'reverse',label:'反打',ratio:'16:9'}],
});

// Creative style descriptions follow the original workshop; labels and prompts
// intentionally contain no model/provider identities.
export const LOOK_STYLES = freeze([
  {
    id: "lookbook",
    label: "设定棚拍",
    group: "真人",
    hint: "灰底三视图",
    prompt:
      "photoreal fashion lookbook character turnaround, seamless light-gray studio, even softbox, 85mm, catalog lighting, standing pose, real skin",
  },
  {
    id: "cinematic",
    label: "写实电影",
    group: "真人",
    hint: "35mm，浅景深",
    prompt:
      "photoreal cinematic film still, 35mm anamorphic, shallow depth of field, muted green-grey grade, overcast natural light, fine film grain, real skin texture",
  },
  {
    id: "street",
    label: "纪实街拍",
    group: "真人",
    hint: "街拍，自然光",
    prompt:
      "photoreal documentary street photography, candid, available light, 50mm, slight grain, unposed, real-world color",
  },
  {
    id: "studio",
    label: "棚拍人像",
    group: "真人",
    hint: "柔光棚，干净背景",
    prompt:
      "photoreal studio portrait, large softbox, seamless light-gray backdrop, 85mm, catchlights, fashion-headshot realism",
  },
  {
    id: "golden",
    label: "黄金时刻",
    group: "真人",
    hint: "暖光逆光",
    prompt:
      "photoreal golden hour photography, warm backlight, rim light, amber highlights, soft flare, natural skin",
  },
  {
    id: "analog",
    label: "胶片颗粒",
    group: "真人",
    hint: "柯达色，颗粒",
    prompt:
      "photoreal analog film photograph, Kodak Portra 400, visible grain, slight fade, 1990s photo realism",
  },
  {
    id: "editorial",
    label: "时尚大片",
    group: "真人",
    hint: "杂志封面光",
    prompt:
      "photoreal high-fashion editorial, Vogue lighting, sharp styling, cinematic color, magazine cover still",
  },
  {
    id: "documentary",
    label: "纪录片",
    group: "真人",
    hint: "手持，现场光",
    prompt:
      "photoreal handheld documentary still, available light, unpolished, National Geographic realism",
  },
  {
    id: "noir",
    label: "黑色电影",
    group: "真人",
    hint: "硬光阴影",
    prompt:
      "photoreal neo-noir cinema, hard side light, deep shadows, wet asphalt, desaturated, 35mm crime still",
  },
  {
    id: "neon",
    label: "霓虹赛博",
    group: "风格化",
    hint: "雨夜霓虹",
    prompt:
      "photoreal cyberpunk night, neon reflections on wet streets, magenta-teal grade, cinematic, cyberpunk restyle",
  },
  {
    id: "anime",
    label: "动漫电影",
    group: "风格化",
    hint: "高完成度动画",
    prompt:
      "high-end anime film still, Ghibli/Makoto Shinkai finish, painterly light, anime restyle, consistent character design",
  },
  {
    id: "watercolor",
    label: "水彩",
    group: "风格化",
    hint: "湿润笔触",
    prompt:
      "fine watercolor illustration, soft bleeds, paper texture, watercolor restyle",
  },
  {
    id: "retro",
    label: "复古",
    group: "风格化",
    hint: "70s 胶片",
    prompt:
      "1970s retro film still, faded dyes, light leak, vintage wardrobe grade, retro restyle",
  },
  {
    id: "block",
    label: "积木",
    group: "风格化",
    hint: "方块造型",
    prompt: "stylized blocky geometric restyle, clean volumes, block restyle",
  },
  {
    id: "mosaic",
    label: "马赛克",
    group: "风格化",
    hint: "碎瓷拼贴",
    prompt: "mosaic tile illustration, fragmented color planes, mosaic restyle",
  },
  {
    id: "ink",
    label: "水墨",
    group: "绘画",
    hint: "留白与墨色",
    prompt: "contemporary ink-wash cinema still, rice paper, empty space, black ink with one color accent",
  },
  {
    id: "oil",
    label: "油画",
    group: "绘画",
    hint: "厚涂笔触",
    prompt: "oil painting still, visible brushwork, Rembrandt lighting, museum canvas texture",
  },
]);
export const PORTRAIT_STYLES = freeze([
  {
    key: "blend",
    label: "人景融合",
    options: [
      { id: "align", label: "轻度对齐", prompt: "light edge alignment: subject sits in the plate, slight contact-shadow, no heavy composite" },
      { id: "natural", label: "自然融合", prompt: "natural person-to-scene composite: matched grain, matched black point, believable contact with the ground and furniture" },
      { id: "deep", label: "深度融合", prompt: "deep integration: subject shares bounce light, occludes and is occluded by the set, same atmospheric haze and depth of field as the background" },
    ],
  },
  {
    key: "light",
    label: "光影融合",
    options: [
      { id: "fill", label: "柔和补光", prompt: "soft fill on the face from the environment, no extra key, shadows wrap gently" },
      { id: "mood", label: "氛围强化", prompt: "mood lighting from the scene amplified on skin: colored bounce, stronger rim if the set has one, cinematic contrast" },
      { id: "match", label: "自然匹配", prompt: "face lighting strictly matches the scene key direction, color temperature, and shadow hardness" },
    ],
  },
  {
    key: "skin",
    label: "皮肤 / 肤色",
    options: [
      { id: "clear", label: "清透修饰", prompt: "clear luminous skin, subtle makeup, no plastic sheen, keep pores faintly" },
      { id: "natural", label: "自然肤质", prompt: "natural living skin, slight unevenness, real subsurface scattering, no airbrushed CGI face" },
      { id: "pores", label: "真实肌理", prompt: "visible skin microstructure: pores, peach fuzz, tiny blemishes, oily T-zone, photoreal texture" },
    ],
  },
  {
    key: "grain",
    label: "纹理",
    options: [
      { id: "soft", label: "柔和纹理", prompt: "soft micro-texture, gentle diffusion, no crunchy sharpening" },
      { id: "natural", label: "自然纹理", prompt: "natural fabric and skin texture, matched to the plate" },
      { id: "film", label: "颗粒质感", prompt: "fine photographic film grain over the whole frame, including skin, not digital noise" },
    ],
  },
  {
    key: "sharp",
    label: "锐度",
    options: [
      { id: "soft", label: "柔焦", prompt: "soft-focus portrait, gentle bloom on highlights, eyes still readable" },
      { id: "standard", label: "标准清晰", prompt: "standard photographic sharpness, eyes crisp, no oversharpen halo" },
      { id: "crisp", label: "高清锐化", prompt: "high-definition crispness, fine hair and fabric detail, controlled, not crunchy" },
    ],
  },
].map(group => ({id:group.key,...group})));
export const PORTRAIT_EMOTIONS = freeze([
  { id: "neutral", label: "中性", prompt: "neutral resting face, relaxed eyes and mouth", face: { brow: 0, eye: 0.55, mouth: 0, open: 0.08 } },
  { id: "smile", label: "微笑", prompt: "genuine small smile, slight cheek raise, kind eyes", face: { brow: 0.12, eye: 0.5, mouth: 0.55, open: 0.12 } },
  { id: "laugh", label: "大笑", prompt: "open-mouth laugh, lifted cheeks, squinted happy eyes", face: { brow: 0.2, eye: 0.35, mouth: 0.85, open: 0.55 } },
  { id: "tender", label: "温柔", prompt: "tender warm gaze, soft half-smile, relaxed brows", face: { brow: 0.18, eye: 0.52, mouth: 0.35, open: 0.1 } },
  { id: "love", label: "爱意", prompt: "in-love look, softened eyes, gentle smile, slightly parted lips", face: { brow: 0.16, eye: 0.48, mouth: 0.4, open: 0.18 } },
  { id: "sad", label: "悲伤", prompt: "sad downturned mouth, inner brows raised, wet eyes", face: { brow: -0.35, eye: 0.42, mouth: -0.55, open: 0.08 } },
  { id: "cry", label: "哭泣", prompt: "crying, trembling mouth, tears, crumpled brows", face: { brow: -0.5, eye: 0.28, mouth: -0.4, open: 0.22 } },
  { id: "angry", label: "愤怒", prompt: "anger, lowered brows, tight jaw, hard stare", face: { brow: -0.55, eye: 0.45, mouth: -0.25, open: 0.12 } },
  { id: "disgust", label: "厌恶", prompt: "disgust, wrinkled nose, raised upper lip, squint", face: { brow: -0.3, eye: 0.4, mouth: -0.15, open: 0.16 } },
  { id: "fear", label: "恐惧", prompt: "fear, wide eyes, raised brows, tense open mouth", face: { brow: 0.55, eye: 0.85, mouth: -0.1, open: 0.35 } },
  { id: "surprise", label: "惊讶", prompt: "surprise, high round brows, wide eyes, round open mouth", face: { brow: 0.7, eye: 0.9, mouth: 0.05, open: 0.5 } },
  { id: "scorn", label: "轻蔑", prompt: "scorn / smirk, one-sided mouth, half-lidded eyes", face: { brow: -0.15, eye: 0.4, mouth: 0.25, open: 0.1 } },
  { id: "shy", label: "害羞", prompt: "shy, glance aside, faint blush, small closed smile", face: { brow: 0.1, eye: 0.45, mouth: 0.3, open: 0.06 } },
  { id: "firm", label: "坚定", prompt: "determined, level brows, set mouth, focused eyes", face: { brow: -0.12, eye: 0.5, mouth: -0.05, open: 0.06 } },
  { id: "tired", label: "疲惫", prompt: "exhausted, heavy lids, slack mouth, low energy", face: { brow: -0.08, eye: 0.28, mouth: -0.12, open: 0.1 } },
  { id: "think", label: "思考", prompt: "thinking, slight frown, eyes not at camera, closed mouth", face: { brow: -0.22, eye: 0.48, mouth: -0.08, open: 0.05 } },
  { id: "nervous", label: "紧张", prompt: "nervous, tight lips, darting eyes, raised inner brows", face: { brow: 0.28, eye: 0.62, mouth: -0.18, open: 0.14 } },
  { id: "cold", label: "冷漠", prompt: "cold blank face, flat affect, unblinking", face: { brow: 0, eye: 0.5, mouth: -0.02, open: 0.04 } },
  { id: "excited", label: "兴奋", prompt: "excited, bright eyes, open smile, lifted brows", face: { brow: 0.4, eye: 0.7, mouth: 0.7, open: 0.32 } },
  { id: "calm", label: "平静", prompt: "calm composed face, slow eyes, relaxed mouth", face: { brow: 0.05, eye: 0.5, mouth: 0.08, open: 0.07 } },
].map(({face,...option}) => option));
export const PORTRAIT_PRESETS = freeze([
 ...PORTRAIT_STYLES.flatMap(group => group.options.map(option => ({...option,id:group.key+':'+option.id,label:group.label+' · '+option.label,group:group.key}))),
 ...PORTRAIT_EMOTIONS.map(option => ({...option,id:'emotion:'+option.id,label:'表演 · '+option.label,group:'emotion'})),
]);
export const EMOTIONS = PORTRAIT_EMOTIONS;

export const IMAGE_ENTITY_FIELDS = freeze(['description','role','identityRegion','age','gender','appearance','costume','material','usedBy','heading','timeOfDay','weather','atmosphere','worldAnchors','extraPrompt']);
const fieldCopy = source => Object.fromEntries(IMAGE_ENTITY_FIELDS.map(key => [key,text(source?.[key])]));
const episodeOf = source => text(source?.episode ?? source?.episodeId ?? source?.episode_id);
const entityKey = entity => [entity.category,entity.scope,entity.scope === 'episode' ? entity.episode : '',entity.category === 'storyboard' ? text(entity.id) : nameKey(entity.name)].join('\u0000');
const isDeleted = item => !item || item.deleted === true || !!item.deletedAt || !!item.deleted_at || item.isDeleted === true;

export function freshImageWorkspace() {return {entities:[],style:'',portraitStyle:''};}

/**
 * Returns a new creative-only entity list. Persist the result in
 * project.imageWorkspace.entities after deriving it so newly allocated IDs stay
 * stable. Existing workspace fields win over descriptions from reference assets.
 * Only explicit asset types / shot name lists / scene headings are read.
 */
export function deriveImageEntities(project, uuid = () => globalThis.crypto.randomUUID()) {
 if (!object(project) || typeof uuid !== 'function') throw Error('项目或编号生成器无效');
 const entities=[], byKey=new Map(), byId=new Map(), shots=list(project.shots).filter(s => object(s) && !isDeleted(s));
 const shotIds=new Set(shots.map(s => s.id));
 function add(source, fallbackId='') {
  const category=categoryOf(source.category), name=nameKey(source.name), scope=source.scope === 'series' ? 'series' : 'episode', episode=scope === 'series' ? '' : episodeOf(source);
  if (!category || !name || isDeleted(source)) return null;
  let id=text(source.id)||text(fallbackId);
  const fields=fieldCopy({...source,...(object(source.fields)?source.fields:{})});
  const candidate={id,category,name,scope,episode,fields};
  if(category==='storyboard') candidate.hasReverse=!!source.hasReverse;
  const key=entityKey(candidate), existing=byKey.get(key);
  if(existing) {
   for(const field of IMAGE_ENTITY_FIELDS) if(!existing.fields[field] && fields[field]) existing.fields[field]=fields[field];
   return existing;
  }
  if (!id) id=text(uuid());
  if (!id) throw Error('无法创建图片实体编号');
  if (byId.has(id)) {
   const same=byId.get(id);
   if (same.category===category && same.scope===scope && same.episode===episode) return same;
   throw Error('图片实体编号重复，请先核对项目数据');
  }
  candidate.id=id;entities.push(candidate);byKey.set(key,candidate);byId.set(id,candidate);return candidate;
 }
 for(const source of list(project.imageWorkspace?.entities)) {
  if(!object(source)) continue;
  if(source.category==='storyboard' && !shotIds.has(source.id)) continue;
  add(source);
 }
 const assetCategories={character:'characters',scene:'locations',prop:'props','角色':'characters','场景':'locations','道具':'props'};
 for(const asset of list(project.assets)) {
  const category=assetCategories[asset?.type];if(!category || isDeleted(asset))continue;
  const meta=object(asset.metadata)?asset.metadata:{};
  const existing=byId.get(text(meta.entityId)||text(asset.id));
  if(existing?.category===category) {
   const fields=fieldCopy({...asset,...(object(asset.fields)?asset.fields:{})});
   for(const field of IMAGE_ENTITY_FIELDS) if(!existing.fields[field] && fields[field])existing.fields[field]=fields[field];
   continue;
  }
  const ep=episodeOf(meta)||episodeOf(asset),scope=asset.scope === 'series' ? 'series' : asset.scope === 'episode' || ep ? 'episode' : 'series';
  add({...asset,category,id:text(meta.entityId)||text(asset.id),name:text(meta.entityName)||asset.name,scope,episode:ep});
 }
 for(const [index,shot] of shots.entries()) {
  const episode=episodeOf(shot);
  for(const [key,category] of [['characterNames','characters'],['locationNames','locations'],['propNames','props']]) {
   const names=[...list(shot[key]),...(category==='locations'&&text(shot.scene)&&shot.scene!=='未指定场景'?[shot.scene]:[])];
   for(const raw of names) {
    const name=nameKey(raw);if(!name || typeof raw!=='string')continue;
    // A series entity explicitly covers the same named entity in every episode.
    if(byKey.has(entityKey({category,scope:'series',episode:'',name})))continue;
    add({category,name,scope:'episode',episode,fields:category==='locations'?{heading:name}:{}});
   }
  }
  if(!text(shot.id))continue;
  const old=byId.get(shot.id), hasReverse=shot.angle==='过肩镜头' && !!shot.otsFrom && !!shot.otsTo && shot.otsFrom!==shot.otsTo;
  if(old) {
   if(old.category!=='storyboard')throw Error('分镜与图片实体编号冲突');
   old.episode=episode;old.scope='episode';old.hasReverse=hasReverse;
   if(!old.fields.description)old.fields.description=text(shot.description);
  } else add({id:shot.id,category:'storyboard',name:text(shot.name)||'镜头 '+(index+1),scope:'episode',episode,hasReverse,fields:{description:text(shot.description),heading:text(shot.scene)}});
 }
 return entities;
}

function slotOf(category, slot) {
 const id=typeof slot==='string'?slot:slot?.id;
 const selected=IMAGE_SLOTS[category]?.find(option => option.id===id);
 if(!selected)throw Error('该图片类型不支持这个视角');
 return selected;
}
function scopeMatches(entity,item,projectId='') {
 if(isDeleted(item) || !text(item.id) || !object(item.metadata))return false;
 if(['failed','running','cancelled'].includes(item.status))return false;
 const expectedProject=text(projectId)||text(entity.projectId);
 if(expectedProject && item.projectId!==expectedProject)return false;
 const meta=item.metadata;
 if(meta.entityId!==entity.id || (meta.category && categoryOf(meta.category)!==entity.category))return false;
 if(meta.scope && meta.scope!==entity.scope)return false;
 if(meta.episode!==undefined && entity.scope==='episode' && text(meta.episode)!==text(entity.episode))return false;
 return true;
}
function latestSlot(entity, slot, items, projectId='') {
 const stamp=item => Number.isFinite(item.created)?item.created:Number.isFinite(item.createdAt)?item.createdAt:Date.parse(item.created||item.createdAt||'')||0;
 return list(items).filter(item => scopeMatches(entity,item,projectId) && item.metadata.slot===slot).sort((a,b)=>stamp(b)-stamp(a))[0];
}

/**
 * mode=missing fills empty slots, mode=all plans the supplied group including
 * filled slots. Pass only the current project's gallery, or set projectId.
 * Series entities remain eligible while filtering an episode.
 */
export function planImageBatch({category,entities=[],items=[],mode='missing',episode,projectId}={}) {
 category=categoryOf(category);if(!category)throw Error('请选择图片类型');
 if(!['missing','all'].includes(mode))throw Error('批量模式应为 missing 或 all');
 const result=[],seen=new Set();
 for(const entity of list(entities)) {
  if(!object(entity)||entity.category!==category||!text(entity.id)||isDeleted(entity))continue;
  if(episode!==undefined && episode!==null && episode!=='' && entity.scope!=='series' && text(entity.episode)!==text(episode))continue;
  for(const slot of IMAGE_SLOTS[category]) {
   if(category==='storyboard'&&slot.id==='reverse'&&!entity.hasReverse)continue;
   const key=entity.id+'\u0000'+slot.id;if(seen.has(key))continue;seen.add(key);
   if(mode==='all'||!latestSlot(entity,slot.id,items,projectId))result.push({entityId:entity.id,slot:slot.id});
  }
 }
 return result;
}

/** Latest canonical identity/structure references only. The caller supplies this
 * project's items (or entity.projectId); never returns image bytes or identities.
 * A scene plan anchors all four directions; the N still adds finished art detail.
 */
export function imageSlotReferences(entity, slot, items=[]) {
 if(!object(entity)||!categoryOf(entity.category))throw Error('图片实体无效');
 slot=slotOf(entity.category,slot).id;
 const candidates=[];
 if(entity.category==='characters'&&slot!=='front')candidates.push(latestSlot(entity,'front',items));
 if(entity.category==='locations'&&slot!=='plan') {
  candidates.push(latestSlot(entity,'plan',items));
  if(slot!=='view_n')candidates.push(latestSlot(entity,'view_n',items));
 }
 return candidates.filter(Boolean).filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index).slice(0,3).map(item=>({id:item.id}));
}

function stylePrompt(style) {
 if(typeof style!=='string')return '';
 return LOOK_STYLES.find(option=>option.id===style)?.prompt||style;
}
function portraitPrompt(value) {
 if(typeof value==='string' && value.trimStart().startsWith('{')) {
  try {value=JSON.parse(value);} catch {throw Error('人物质感选项无效');}
  if(!object(value))throw Error('人物质感选项无效');
 }
 const selected=[];
 if(typeof value==='string') {
  if(!value)return '';
  const preset=PORTRAIT_PRESETS.find(option=>option.id===value);
  if(!preset)throw Error('人物质感选项无效');
  selected.push(preset.prompt);
 } else if(object(value)) {
  for(const group of PORTRAIT_STYLES) {
   const option=group.options.find(option=>option.id===value[group.key]);
   if(option)selected.push(option.prompt);
  }
  const emotion=PORTRAIT_EMOTIONS.find(option=>option.id===value.emotion);
  if(emotion)selected.push('Facial performance: '+emotion.prompt+'. Keep identity and wardrobe.');
 } else if(value!==undefined&&value!==null)throw Error('人物质感选项无效');
 return selected.length?'人物质感与表演：'+selected.join('; ')+'. 保持身份、服装和机位，只改变所选质感或表情。':'';
}

/**
 * Returns the production template plus complete storyboard params/assetIds.
 * It never edits the source shot or action/dialogue. OTS reverse requires two
 * distinct valid character reference images via the shared storyboard validator.
 */
export function buildWorkflowPrompt(project, entity, slot, options={}) {
 if(!object(project)||!object(entity))throw Error('项目或图片实体无效');
 const category=categoryOf(entity.category);slot=slotOf(category,slot);
 const fields={...fieldCopy(entity),...fieldCopy({...entity,...(object(entity.fields)?entity.fields:{})})};
 const settings=object(project.settings)?project.settings:{},workspace=object(project.imageWorkspace)?project.imageWorkspace:{};
 const refCount=options.referenceCount??0;
 const style=stylePrompt(options.style??workspace.style??'');
 const portrait=portraitPrompt(options.portraitStyle??workspace.portraitStyle??'');
 const force=options.forceAspect===true;
 let aspect=slot.ratio;
 if(category==='locations'&&slot.id!=='plan'||category==='storyboard'||category==='characters'&&force)aspect=options.aspect||settings.ratio||slot.ratio;
 const extra=[fields.extraPrompt,text(options.extraPrompt),portrait].filter(Boolean).join('\n');
 let shotData=null;
 const input={...fields,name:text(entity.name),kind:slot.id,aspect,style,styleLock:text(settings.storyStyle),referenceCount:refCount,referenceIdentity:options.referenceIdentity!==false,extraPrompt:extra};
 if(category==='storyboard') {
  const shot=list(project.shots).find(shot=>shot.id===entity.id);
  if(!shot)throw Error('对应分镜已不存在，请重新选择镜头');
  const p={...project,assets:list(project.assets),shots:list(project.shots),settings};
  if(slot.id==='reverse')SB.assertPair(p,shot);
  shotData=SB.shotData(p,shot,slot.id==='reverse');
  input.aspect=options.aspect||shotData.params.ratio||slot.ratio;
  Object.assign(input,{scene:text(shot.scene),action:text(shot.description),dialogue:text(shot.dialogue),characters:list(shot.characterNames).join('、'),props:list(shot.propNames).join('、'),continuity:text(shot.continuity)});
 }
 const result=buildImageWorkshopPrompt(category,input);
 if(shotData) {
  result.prompt+='\n完整分镜参数与原文：\n'+shotData.prompt;
  result.params={...shotData.params,ratio:result.aspect};
  result.assetIds=[...shotData.assetIds];
 }
 return result;
}

