import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/studio/core.mjs';
import {ensureDesk,parseEpisode,syncShots,prepareStill,imageURL,acceptImage,scriptEpisodes,scriptWindow,applyScriptDraft} from '../public/studio/pianchang-core.mjs';
const script='第一集\n1-1 日 内 门房\n人物：阿青、小林\n道具：铜铃\n△阿青拿起铜铃。\n阿青：走。\n第二集\n2-1 夜 外 江边\n人物：小林\n△小林停下。';
let n=0;const uid=()=>`test-${++n}`;
const make=()=>({...C.project(),script});
const item=(id,e,slot)=>({id,name:id,kind:'角色',metadata:{entityId:e,slot},prompt:'画面要求'});

test('imported canonical shots hydrate without losing references, output, or creative settings',()=>{
 const p=make();p.shots=[{id:'old-shot',episode:'第一集',scene:'门房',description:'原动作',dialogue:'走。',duration:5,assetId:'old-image',reverseAssetId:'reverse-image',characters:['ref'],otsFrom:'ref',otsTo:'ref2',continuity:'衣服不变',negative:'不加人',virtualStage:{retained:true},sourceText:'原动作'}];
 const before=structuredClone(p.shots);const d=ensureDesk(p,uid);assert.equal(d.beats.length,1);assert.deepEqual(p.shots,before);
 d.beats[0].camera_move='斯坦尼康跟拍';syncShots(p,d);
 assert.equal(p.shots[0].camera,'斯坦尼康跟拍');for(const key of ['characters','otsFrom','negative','virtualStage','continuity','reverseAssetId'])assert.deepEqual(p.shots[0][key],before[0][key]);
});
test('episode parsing is isolated, source-pinned, and preserves exact matches only',()=>{
 const p=make();const d=ensureDesk(p,uid);parseEpisode(p,uid);const ids=d.beats.map(b=>b.id);assert.ok(d.beats.every(b=>b.episode==='第一集'));assert.equal(p.script,script);
 d.stills[`${ids[0]}:frame`]='data:image/png;base64,YQ==';d.beats[0].frameAssetId='kept';syncShots(p,d);parseEpisode(p,uid);assert.deepEqual(d.beats.map(b=>b.id),ids);assert.equal(d.beats[0].frameAssetId,'kept');
 d.episode='第二集';parseEpisode(p,uid);assert.equal(d.beats.filter(b=>b.episode==='第一集').length,2);assert.equal(d.beats.filter(b=>b.episode==='第二集').length,1);
 const second=d.beats.find(b=>b.episode==='第二集').id;d.episode='第一集';p.script=p.script.replace('阿青拿起铜铃','阿青放下铜铃');parseEpisode(p,uid);
 assert.notEqual(d.beats[0].id,ids[0]);assert.equal(d.beats[0].frameAssetId,'');assert.ok(d.archivedShots.some(b=>b.id===ids[0]));assert.equal(d.beats.find(b=>b.episode==='第二集').id,second);assert.ok(d.stills[`${ids[0]}:frame`]);
});
test('source-identical repeated lines have distinct stable occurrence IDs',()=>{
 const p=make();p.script='第一集\n1-1 日 内 门房\n△阿青走。\n△阿青走。';const d=ensureDesk(p,uid);parseEpisode(p,uid);const ids=d.beats.map(b=>b.id);assert.equal(new Set(ids).size,2);parseEpisode(p,uid);assert.deepEqual(d.beats.map(b=>b.id),ids);
});
test('slots use canonical identity/space references and readable creative prompts',()=>{
 const p=make(),d=ensureDesk(p,uid);parseEpisode(p,uid);const c=d.characters[0];acceptImage(p,d,`${c.id}:front`,item('front-image',c.id,'front'));d.grades[c.id]={blend:'natural',skin:'pores'};
 const side=prepareStill(p,d,'characters',c.id,'side');assert.deepEqual(side.references,[{id:'front-image'}]);assert.equal(side.ratio,'3:4');assert.match(side.prompt,/pores/);assert.doesNotMatch(side.prompt,/blend:natural/);
 d.forceChar=true;d.aspect='9:16';assert.equal(prepareStill(p,d,'characters',c.id,'expr_smile').ratio,'9:16');
 const l=d.locations.find(l=>!l.archived);acceptImage(p,d,`${l.id}:plan`,item('room-plan',l.id,'plan'));acceptImage(p,d,`${l.id}:view_n`,item('room-n',l.id,'view_n'));assert.deepEqual(prepareStill(p,d,'locations',l.id,'view_w').references,[{id:'room-plan'},{id:'room-n'}]);
});
test('OTS reverse really swaps characters; locked output stays viewable and cannot be regenerated',()=>{
 const p=make(),d=ensureDesk(p,uid);parseEpisode(p,uid);const [a,b]=d.characters.filter(c=>!c.archived);for(const c of [a,b])acceptImage(p,d,`${c.id}:front`,item(`face-${c.id}`,c.id,'front'));
 const beat=d.beats[1];beat.ots_from=a.id;beat.ots_to=b.id;syncShots(p,d);
 const forward=prepareStill(p,d,'storyboard',beat.id,'frame');const reverse=prepareStill(p,d,'storyboard',beat.id,'reverse');assert.match(forward.prompt,new RegExp(`过 ${a.name} 的肩，拍 ${b.name}`));assert.match(reverse.prompt,new RegExp(`过 ${b.name} 的肩，拍 ${a.name}`));assert.deepEqual(forward.references,reverse.references);
 d.images[`${a.id}:front`].adminLocked=true;assert.throws(()=>prepareStill(p,d,'characters',a.id,'front'),/锁定/);assert.ok(imageURL(d.stills[`${a.id}:front`]));
});
test('untrusted image links cannot execute or load external tracking URLs',()=>{
 for(const bad of ['javascript:alert(1)','https://evil.invalid/x.png','data:image/svg+xml;base64,YQ==','//evil.invalid/x','/api/images?action=delete&id=some'])assert.equal(imageURL(bad),'');
 assert.equal(imageURL('/api/images?action=content&id=image-a'),'/api/images?action=content&id=image-a');
});
test('legacy episode annotations and Chinese/numeric aliases stay in the same episode',()=>{
 const p=make();p.shots=[{id:'legacy-one',episode:'第1集 原著第1—2章',scene:'1-1 日 内 门房',sourceText:'阿青拿起铜铃。',description:'阿青拿起铜铃。',dialogue:'',duration:3,assetId:'original-frame'}];
 const d=ensureDesk(p,uid);assert.equal(d.beats[0].episode,'第一集');assert.equal(d.episode,'第一集');parseEpisode(p,uid);assert.equal(d.beats[0].id,'legacy-one');assert.equal(d.beats[0].frameAssetId,'original-frame');assert.equal(p.shots[0].sourceEpisode,'第1集 原著第1—2章');
});

test('per-episode save preserves bible, CRLF and all other episodes; stale drafts cannot overwrite newer text',()=>{
 const p=make();p.script='人物小传：阿青\r\n第一集\r\n1-1 日 内 门房\r\n△阿青走。\r\n第二集\r\n2-1 夜 外 江边\r\n△小林停下。';const d=ensureDesk(p,uid),original=p.script,part=scriptWindow(p);assert.equal(part.name,'第一集');assert.ok(!part.text.includes('第二集'));
 d.scriptDrafts={'第一集':{source:part.text,text:part.text.replace('阿青走','阿青跑')}};applyScriptDraft(p,'第一集');assert.equal(p.script,original.replace('阿青走','阿青跑'));assert.equal(d.scriptHistory[0].text,original);
 const now=scriptWindow(p);d.scriptDrafts={'第一集':{source:now.text,text:now.text+'新动作'}};p.script=p.script.replace('阿青跑','阿青坐下');assert.throws(()=>applyScriptDraft(p,'第一集'),/其他页面更新/);assert.ok(d.scriptDrafts['第一集']);
  assert.deepEqual(scriptEpisodes('第２集\n动作\n第两集\n更长的正文').map(e=>e.name),['第两集']);
});
test('episode style lock and axis poses reach both generation prompts with camera direction reversed only',async()=>{
 const {axisBlock,axisDistance,axisPrompt}=await import('../public/studio/pianchang-axis.mjs');const {zipStore}=await import('../public/studio/script-docx.mjs');
 assert.equal(axisBlock({a:{along:Infinity,off:999,pose:'bad'}}).a.along,28);assert.equal(axisBlock({a:{off:999}}).a.off,32);assert.equal(axisDistance(),2.2);
 const p=make(),d=ensureDesk(p,uid);parseEpisode(p,uid);const [a,b]=d.characters;for(const c of [a,b])acceptImage(p,d,`${c.id}:front`,item('face-'+c.id,c.id,'front'));
 const beat=d.beats[0];beat.composition='过肩镜头';beat.ots_from=a.id;beat.ots_to=b.id;beat.ots_block=JSON.stringify({a:{along:15,pose:'kneel'},b:{along:85,pose:'sit'}});d.episodeStyles={'第一集':'冷调雨夜风格锁'};syncShots(p,d);
 for(const slot of ['frame','reverse']){const r=prepareStill(p,d,'storyboard',beat.id,slot);assert.match(r.prompt,/冷调雨夜风格锁/);assert.match(r.prompt,new RegExp(a.name+'：双膝跪地'));assert.match(r.prompt,new RegExp(b.name+'：坐在同一把椅子'));assert.match(r.prompt,/3.5 米/);}
 const binary=new Uint8Array([0,255,128,65]),zip=zipStore([['图.png',binary]]),dv=new DataView(zip.buffer);assert.deepEqual(zip.slice(30+dv.getUint16(26,true),30+dv.getUint16(26,true)+4),binary);
});
