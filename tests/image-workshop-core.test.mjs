import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {
  IMAGE_WORKSHOP_CATEGORIES, IMAGE_WORKSHOP_LIMITS, imageWorkshopKind,
  inspectImageWorkshopImport, selectImageWorkshopImport,
  readImageWorkshopArchive, buildImageWorkshopPrompt,
} from '../public/studio/image-workshop-core.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const ownRow = row => ({user_id: 'legacy-own-user', project_id: 'p1', episode_id: 'ep2', ...row});
function backup() {
  return {
    at: 1792970000000, user_id: 'legacy-own-user',
    data: {
      jingben_projects: [ownRow({id: 'p1', title: '旧作《门外》', visual_style: '真实摄影', apiKey: 'do-not-copy'})],
      jingben_episodes: [ownRow({id: 'ep2', ep_no: 2, title: '雨夜', script_text: '不应该批量导入剧本正文'})],
      jingben_characters: [ownRow({id: 'c1', name: '阿青', appearance: '左眉有疤', scope: 'series'})],
      jingben_locations: [ownRow({id: 'l1', name: '门房', scope: 'episode'})],
      jingben_props: [ownRow({id: 'prop1', name: '铜铃', scope: 'series'})],
      jingben_beats: [ownRow({id: 'b1', seq: 3})],
      jingben_images: [
        ownRow({id: 'im-front', entity_id: 'c1', kind: 'front', scope: 'series', prompt: ' 原提示词\r\n不删改。 ', image_url: png, created_at: '2026-10-20T08:10:00.000Z', owner: 'do-not-copy', provider: 'do-not-copy'}),
        ownRow({id: 'im-view', entity_id: 'l1', kind: 'view_n', prompt: '门房北机位', image_url: 'https://images.example.test/original.png?v=1', created_at: '2026-10-21T00:00:00Z'}),
        ownRow({id: 'im-prop', entity_id: 'prop1', kind: 'hero', prompt: '铜铃材质', image_url: png}),
        ownRow({id: 'im-shot', entity_id: 'b1', kind: 'reverse', prompt: '反打', image_url: png}),
      ],
      jingben_members: [{user_id: 'legacy-own-user', phone: 'private-phone', password_hash: 'private-hash', email: 'private@email.test'}],
      user: [{password: 'private-password'}], account: [{accessToken: 'private-access-token'}],
    },
    credentials: 'private-root',
  };
}

function select(preview, ids = preview.candidates.map(c => c.sourceId)) {
  return selectImageWorkshopImport(preview, {selectedSourceIds: ids, confirmOwnImages: true});
}

function deepKeys(v) {
  return v && typeof v === 'object' ? Object.entries(v).flatMap(([k, item]) => [k, ...deepKeys(item)]) : [];
}

test('reads the real user backup contract without changing it and keeps exact creative data', () => {
  const raw = backup(), original = structuredClone(raw);
  const result = inspectImageWorkshopImport(JSON.stringify(raw));
  assert.deepEqual(raw, original);
  assert.equal(result.format, 'jingben-user-backup-v1');
  assert.equal(result.sourceOwnerId, raw.user_id);
  assert.equal(result.sourceExportedAt, raw.at);
  assert.equal(result.total, 4);
  assert.deepEqual(result.candidates.map(c => c.kind), ['角色','场景','道具','分镜']);
  const c = result.candidates[0];
  assert.equal(c.prompt, raw.data.jingben_images[0].prompt);
  assert.equal(c.src, png);
  assert.equal(c.name, '阿青 · 正面');
  assert.equal(c.width, 1); assert.equal(c.height, 1);
  assert.equal(c.sourceCreated, '2026-10-20T08:10:00.000Z');
  assert.equal(c.sourceEpisode, '第2集 · 雨夜');
  assert.deepEqual(c.projectMeta, {sourceProjectId:'p1',sourceEpisodeId:'ep2',title:'旧作《门外》',visualStyle:'真实摄影',episodeTitle:'雨夜',episodeNumber:2});
  assert.match(result.warnings.join('\n'), /尚未远程核验/);
  assert.match(result.warnings.join('\n'), /远程原图尚未迁入/);
  assert.equal(result.candidates[1].src, 'https://images.example.test/original.png?v=1');
  assert.equal('width' in result.candidates[1], false);
});

test('selection requires a checked preview, explicit ids, and confirmation; never selects all by default', () => {
  const preview = inspectImageWorkshopImport(backup());
  assert.throws(() => selectImageWorkshopImport(preview), /确认/);
  assert.throws(() => selectImageWorkshopImport(preview, {confirmOwnImages:true}), /明确选择/);
  assert.throws(() => select(preview, []), /明确选择/);
  assert.throws(() => select(preview, ['not-in-file']), /未检查/);
  assert.throws(() => select(preview, [preview.candidates[0].sourceId,preview.candidates[0].sourceId]), /重复/);
  assert.throws(() => select(structuredClone(preview)), /先检查/);
  assert.equal(Object.isFrozen(preview.candidates[0].projectMeta), true);
  assert.throws(() => {preview.candidates[0].prompt = 'replace';}, TypeError);
  const picked = select(preview, [preview.candidates[2].sourceId]);
  assert.equal(picked.assets.length, 1);
  assert.equal(picked.assets[0].name, '铜铃 · 道具主图');
  assert.equal(picked.unavailable.length, 0);
});

test('select output excludes owner, member/password, account, public permission, provider and script rows', () => {
  const raw = backup(); raw.data.jingben_images[0].is_public = true;
  const result = select(inspectImageWorkshopImport(raw));
  const encoded = JSON.stringify(result);
  for (const s of ['legacy-own-user','private-phone','private-hash','private@email.test','private-password','private-access-token','private-root','do-not-copy','不应该批量导入剧本正文']) assert.equal(encoded.includes(s), false, s);
  for (const k of ['sourceOwnerId','user_id','owner','ownerId','phone','email','password_hash','password','accessToken','credentials','provider','apiKey','is_public','script_text']) assert.equal(deepKeys(result).includes(k), false, k);
});

test('does not infer ownership from current login or provider assignment and rejects mixed-owner creative rows', () => {
  const raw = backup();
  raw.data.jingben_images.push(ownRow({id:'foreign-image',user_id:'someone-else',entity_id:'c1',kind:'front',prompt:'FOREIGN-SECRET',image_url:png}));
  raw.data.jingben_characters[0].user_id = 'someone-else';
  assert.throws(() => inspectImageWorkshopImport(raw, {expectedSourceOwnerId:'canvas-uuid'}), /不一致/);
  const preview = inspectImageWorkshopImport(raw);
  assert.equal(preview.total, 5); assert.equal(preview.candidates.length, 4);
  assert.equal(preview.unavailable.length, 1);
  assert.equal(preview.candidates[0].name, '角色 · 正面');
  assert.equal(JSON.stringify(preview).includes('FOREIGN-SECRET'), false);
  assert.equal(JSON.stringify(preview).includes('someone-else'), false);
  const failed = select(preview, [preview.unavailable[0].sourceId]);
  assert.deepEqual(failed.assets, []);
  assert.match(failed.unavailable[0].reason, /归属/);
});

test('source ids are stable under reorder and duplicate source ids fail without silently overwriting', () => {
  const raw = backup(), first = inspectImageWorkshopImport(raw);
  raw.data.jingben_images.reverse();
  const second = inspectImageWorkshopImport(raw);
  assert.deepEqual(new Set(first.candidates.map(c=>c.sourceId)),new Set(second.candidates.map(c=>c.sourceId)));
  raw.data.jingben_images.push({...raw.data.jingben_images[0]});
  assert.throws(() => inspectImageWorkshopImport(raw), /重复的图片编号/);
});

test('real entity relations disambiguate reverse/detail and foreign project/episode relations are not adopted', () => {
  const raw = backup();
  raw.data.jingben_images[1].kind = 'reverse';
  raw.data.jingben_images[2].kind = 'detail';
  assert.deepEqual(inspectImageWorkshopImport(raw).candidates.map(c=>c.kind),['角色','场景','道具','分镜']);
  raw.data.jingben_locations[0].project_id = 'different-project';
  raw.data.jingben_props[0].episode_id = 'another-episode';
  raw.data.jingben_props[0].scope = 'episode';
  const result = inspectImageWorkshopImport(raw);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.unavailable.length, 2);
  assert.equal(imageWorkshopKind('detail'), null);
  assert.equal(imageWorkshopKind('reverse'), null);
  assert.equal(imageWorkshopKind('expr_cry').kind, '角色');
  assert.equal(imageWorkshopKind('plan').kind, '场景');
});

test('keeps missing/local/unreadable image failures explicit and does not manufacture sizes or placeholders', () => {
  for (const [src, reason] of [[null,/没有/],['file:gone',/未能展开/],['data:image/png;base64,SGVsbG8=',/格式或尺寸/],['data:image/svg+xml;base64,PHN2Zy8+',/仅支持/],['not a url',/链接无效/]]) {
    const raw = backup(); raw.data.jingben_images = [{...raw.data.jingben_images[0],image_url:src}];
    const preview = inspectImageWorkshopImport(raw), c = preview.candidates[0];
    assert.equal(c.available,false); assert.equal(c.src,''); assert.equal('width' in c,false);
    assert.match(c.reason,reason);
    const selected = select(preview); assert.equal(selected.assets.length,0); assert.equal(selected.unavailable.length,1);
  }
});

test('local converter never follows source URLs or reads local files, rejects unsafe/credential URLs', () => {
  const prior = globalThis.fetch;
  globalThis.fetch = () => {throw Error('must not fetch');};
  try {
    for (const src of ['javascript:alert(1)','http://images.example.test/a.jpg','https://user:password@images.example.test/a.jpg','https://127.0.0.1/a.png','https://0x7f000001/a.png','https://[::1]/a.png','https://[fc00::1]/a.png','https://metadata.google.internal/a.png','https://192.168.1.2/a.png','https://images.example.test/a.png?access=secret','https://images.example.test/a.png?access_token=secret','https://images.example.test/a.png?key=secret','https://images.example.test/a.png?X-Amz-Signature=secret']) {
      const raw = backup(); raw.data.jingben_images[0].image_url=src;
      const p = inspectImageWorkshopImport(raw); assert.equal(p.candidates[0].available,false,src);
      assert.equal(JSON.stringify(select(p,[p.candidates[0].sourceId])).includes('secret'),false);
    }
    assert.equal(inspectImageWorkshopImport(backup()).candidates[1].available,true);
  } finally {globalThis.fetch=prior;}
});

test('rejects invalid backup shapes and over-limit values without truncating creative text', () => {
  for (const raw of ['not JSON',{}, {at:0,user_id:'own',data:{}}]) assert.throws(()=>inspectImageWorkshopImport(raw));
  const raw=backup(); raw.data.jingben_images[0].prompt='字'.repeat(IMAGE_WORKSHOP_LIMITS.text+1);
  assert.throws(()=>inspectImageWorkshopImport(raw),/没有被截断/);
  const missing=backup(); delete missing.user_id; assert.throws(()=>inspectImageWorkshopImport(missing),/本人标识/);
  const fullSnapshot={at:0,data:backup().data}; assert.throws(()=>inspectImageWorkshopImport(fullSnapshot),/本人标识/);
  const decoded=inspectImageWorkshopImport(new TextEncoder().encode('\uFEFF'+JSON.stringify(backup())));
  assert.equal(decoded.candidates.length,4);
});

// Standard ZIP fixture builder, with independently compressed payloads from
// Node zlib. Reader tests validate real wire structure and hostile archives.
function zip(entries, method=0) {
  let offset=0; const locals=[],centrals=[];
  for (const [path,value] of entries) {
    const name=Buffer.from(path), bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
    const packed=method===8?deflateRawSync(bytes):bytes;
    let crc=0xffffffff;
    for (const n of bytes) {crc^=n;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,packed);centrals.push(central,name);offset+=local.length+name.length+packed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}

test('reads plain JSON or a stored ZIP wrapper around the same real backup contract', async () => {
  const json=JSON.stringify(backup());
  assert.equal((await readImageWorkshopArchive(new Blob([json]))).candidates.length,4);
  const result=await readImageWorkshopArchive(zip([['备份/jingben-backup.json',backup()],['notes.txt','only the real user backup is read']]));
  assert.equal(result.candidates.length,4);
  assert.deepEqual(select(result).assets.map(a=>a.sourceId),select(inspectImageWorkshopImport(backup())).assets.map(a=>a.sourceId));
});

test('reads independently deflated ZIP JSON on runtimes with deflate-raw support', async t => {
  try {new DecompressionStream('deflate-raw');} catch {t.skip('runtime has no deflate-raw; converter provides direct-JSON recovery');return;}
  const result=await readImageWorkshopArchive(zip([['jingben-backup.json',backup()]],8));
  assert.equal(result.candidates[0].src,png);
});

test('rejects unsafe paths, duplicate manifests, malformed ZIP and corrupt content', async () => {
  await assert.rejects(()=>readImageWorkshopArchive(zip([['../jingben-backup.json',backup()]])),/路径不安全/);
  await assert.rejects(()=>readImageWorkshopArchive(zip([['jingben-backup.json',backup()],['jingben-backup.json',backup()]])),/路径不安全或重复/);
  await assert.rejects(()=>readImageWorkshopArchive(zip([['a.json',backup()],['b.json',backup()]])),/唯一/);
  await assert.rejects(()=>readImageWorkshopArchive(zip([['source.json',{files:['not a user backup']}]])),/本人备份/);
  await assert.rejects(()=>readImageWorkshopArchive(new Uint8Array([80,75,1,2])),/目录损坏/);
  const corrupt=zip([['jingben-backup.json',backup()]]);corrupt[60]^=1;
  await assert.rejects(()=>readImageWorkshopArchive(corrupt),/校验失败/);
});

test('provides four source-based templates with explicit reference consistency and no provider fields', () => {
  assert.deepEqual(IMAGE_WORKSHOP_CATEGORIES.map(c=>c.label),['角色','场景','道具','分镜']);
  const c=buildImageWorkshopPrompt('characters',{name:'阿青',role:'守门人',appearance:'左眉有疤',costume:'中国警服',kind:'expr_cry',referenceCount:1,apiKey:'private',provider:'private'});
  assert.equal(c.aspect,'1:1');assert.match(c.prompt,/中国 \/ 东亚面孔/);assert.match(c.prompt,/只有一人/);assert.match(c.prompt,/湿润眼眶/);assert.match(c.prompt,/固定参考图人物身份/);assert.equal(c.referenceHints.length,1);
  assert.equal(JSON.stringify(c).includes('private'),false);
  const plan=buildImageWorkshopPrompt('场景',{name:'门房',kind:'plan',worldAnchors:'西侧门，东侧窗',referenceCount:1});
  assert.equal(plan.aspect,'1:1');assert.match(plan.prompt,/正交垂直俯视白模/);assert.match(plan.prompt,/北为画面上方/);assert.match(plan.prompt,/西侧门，东侧窗/);
  assert.match(buildImageWorkshopPrompt('locations',{kind:'view_w'}).prompt,/西侧，朝东/);
  assert.match(buildImageWorkshopPrompt('props',{name:'铜铃',material:'磨损黄铜',referenceCount:1}).prompt,/外形、材质、颜色/);
});

test('storyboard template preserves exact action/dialogue and stable axis without rewriting scripts', () => {
  const action='△他抬手。\r\n\r\n△门外停下一把伞。',dialogue='阿青：先别开门。';
  const out=buildImageWorkshopPrompt('storyboard',{scene:'2-1 夜 内 门房',action,dialogue,characters:'阿青、守夜人',kind:'reverse',cameraMove:'斯坦尼康跟拍',continuity:'铜铃始终握在左手',aspect:'9:16',referenceCount:2});
  assert.equal(out.aspect,'9:16');assert.equal(out.prompt.includes(action),true);assert.equal(out.prompt.includes(dialogue),true);
  assert.match(out.prompt,/轴线同一侧/);assert.match(out.prompt,/斯坦尼康跟拍/);assert.match(out.prompt,/铜铃始终握在左手/);
  assert.match(out.prompt,/只改变剧本规定/);
  assert.throws(()=>buildImageWorkshopPrompt('storyboard',{referenceCount:4}),/0–3/);
  assert.throws(()=>buildImageWorkshopPrompt('unknown'),/请选择/);
  assert.throws(()=>buildImageWorkshopPrompt('角色',{aspect:'100:1'}),/画幅无效/);
  assert.equal(buildImageWorkshopPrompt('角色',{referenceCount:1,referenceIdentity:false}).prompt.includes('严格固定参考图人物身份'),false);
});

test('selected legacy entity settings retain their source relation and only creative allowlisted fields',()=>{
 const raw=backup();Object.assign(raw.data.jingben_characters[0],{role:'守门人',age:'25',costume:'  旧青衫\n',password_hash:'PRIVATE-ENTITY-HASH',provider:'PRIVATE-ROUTING',public:true});
 const preview=inspectImageWorkshopImport(raw),picked=select(preview,[preview.candidates[0].sourceId]).assets[0];
 assert.deepEqual(picked.sourceEntity,{id:'c1',name:'阿青',fields:{role:'守门人',age:'25',appearance:'左眉有疤',costume:'  旧青衫\n'}});
 const serialized=JSON.stringify(picked);assert.doesNotMatch(serialized,/PRIVATE-ENTITY-HASH|PRIVATE-ROUTING|password_hash|user_id|provider/);
 picked.sourceEntity.fields.costume='本地改动';assert.equal(preview.candidates[0].sourceEntity.fields.costume,'  旧青衫\n');
});
