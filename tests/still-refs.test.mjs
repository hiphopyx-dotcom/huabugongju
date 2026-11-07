import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {stampSeq, presentSeq, seqText, sourceImage} from '../pages/seq-stamp.mjs';
import {
  STILL_REF_CONTRACT,
  STILL_WIRE_RESOLUTIONS,
  appendRefPrompt,
  assembleStillRefs,
  beginAttempt,
  classifyStillReferences,
  collectStillRefs,
  createStillRun,
  digestStillRef,
  failAttempt,
  finishAttempt,
  mapStillResolution,
  planStillReferences,
  readStillRefSource,
  rehearseStillRequest,
  renderStillCompare,
  renderStillNodeError,
  renderStillRehearsal,
  stillRefFetchTarget,
  stillRequestBody,
  stillResolutionOptions,
} from '../pages/still-refs.mjs';

function png(r, g, b) {
  const raw = Buffer.from([0, r, g, b]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([name, data])) >>> 0);
    return Buffer.concat([len, name, data, crc]);
  };
  const body = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${body.toString('base64')}`;
}

const prop = png(220, 120, 40);
const person = png(40, 90, 200);
const place = png(40, 150, 80);
const output = png(120, 50, 160);
const LIBRARY = '11111111-1111-4111-8111-111111111111';

test('编号只留在元数据里，图片字符串保持原样', async () => {
  const stamp = fs.readFileSync(new URL('../pages/seq-stamp.mjs', import.meta.url), 'utf8');
  const planner = fs.readFileSync(new URL('../pages/still-refs.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(stamp, /canvas|fillText|toDataURL|drawImage/);
  assert.doesNotMatch(planner, /\bfetch\s*\(/);
  assert.equal(seqText('2'), '2');
  assert.equal(seqText('镜头1'), '');
  assert.equal(presentSeq(output, '2').dataUrl, output);
  assert.equal(presentSeq(output, '2').seqLabel, '2');
  assert.equal(presentSeq(output, '镜头1').seqLabel, '');
  assert.equal(await stampSeq(output, '2'), output);
  assert.equal(await stampSeq(prop, '1'), prop);
  assert.equal(await stampSeq(person, ''), person);
  assert.equal(sourceImage(output), output);
  assert.equal(sourceImage(null), '');
});

test('参考图按传入顺序发送，角色只写进说明，不进请求字段', async () => {
  const refs = [
    {name: '样例道具', type: '道具', src: prop, description: '木盒', material: '木头', used_by: '样例人物'},
    {name: '样例人物', type: '人物', role: 'character', src: person, appearance: '短发', costume: '蓝外套'},
    {name: '样例场景', type: '场景', src: place},
  ];
  const plan = await planStillReferences(refs, {wire: 'still', ratio: '16:9'});
  assert.deepEqual(plan.stillRefs, [prop, person, place]);
  assert.equal(plan.imageReferences, undefined);
  const notes = plan.promptNotes.join('\n');
  assert.match(notes, /<IMAGE_0> 样例道具（道具）/);
  assert.match(notes, /<IMAGE_1> 样例人物（character）/);
  assert.match(notes, /of <IMAGE_1> exactly/);
  assert.match(notes, /<IMAGE_2> 样例场景（场景）/);
  assert.doesNotMatch(notes, /of <IMAGE_0> exactly/);
  assert.equal(notes.includes('base64,'), false);
  const prompt = appendRefPrompt('一场戏', plan);
  assert.match(prompt, /^一场戏\n<IMAGE_0> 样例道具/);
  const body = stillRequestBody({prompt, ratio: '16:9', plan, meta: {projectId: 'p', projectName: '样例', name: '一镜', entityKind: '分镜', shotNo: '1'}});
  assert.deepEqual(Object.keys(body), [...STILL_REF_CONTRACT.stillBodyKeys]);
  assert.deepEqual(body.refs, [prop, person, place]);
  assert.equal(body.resolution, '1k');
  assert.equal(Object.hasOwn(body, 'role'), false);
  assert.equal(Object.hasOwn(body, 'seed'), false);
  const html = renderStillCompare({plan, run: createStillRun()});
  const srcs = [...html.matchAll(/data-still-ref="(\d)"[\s\S]*?<img src="([^"]+)"/g)].map(match => match[2]);
  assert.deepEqual(srcs, [prop, person, place]);
  assert.match(html, /将发送 3 张/);
  assert.match(html, /data-still-exact="yes"/);
});

test('白模留在调用方给出的位置，说明里的编号跟着这张图', async () => {
  const plan = await planStillReferences([
    {name: '样例人物', type: '人物', src: person},
    {name: '这一镜白模', role: 'stage_frame', src: place},
  ], {wire: 'still'});
  assert.deepEqual(plan.stillRefs, [person, place]);
  const notes = plan.promptNotes.join('\n');
  assert.match(notes, /IMAGE_1 is this shot's white-stage/);
  assert.match(notes, /<IMAGE_1> into this still/);
  assert.match(notes, /of <IMAGE_0> exactly/);
});

test('超过上限时整单停止，并点名多出来的参考', async () => {
  await assert.rejects(() => planStillReferences([
    {name: '样例道具', src: prop},
    {name: '样例人物', src: person},
    {name: '样例场景', src: place},
    {name: '多出来的样例', src: person},
  ], {wire: 'still'}), /不会只发送前 3 张[\s\S]*多出来的样例/);
  const preview = classifyStillReferences([
    {name: '样例道具', src: prop},
    {name: '样例人物', src: person},
    {name: '样例场景', src: place},
    {name: '多出来的样例', src: person},
  ], {wire: 'still'});
  assert.equal(preview.ok, false);
  assert.deepEqual(preview.stillRefs, []);
  assert.match(renderStillCompare({plan: preview}), /多出来的样例/);
  assert.match(renderStillCompare({plan: preview}), /data-still-exact="no"/);
});

test('调用方自己的 4 张上限会带上未验证说明，图片接口不接受改上限', async () => {
  const four = [prop, person, place, output].map((src, index) => ({name: `样例${index + 1}`, src}));
  const plan = await planStillReferences(four, {wire: 'still', limit: 4});
  assert.equal(plan.stillRefs.length, 4);
  assert.match(plan.diagnostics.join('\n'), /没有被这个仓库验证/);
  await assert.rejects(() => planStillReferences([{name: '样例人物', src: person}], {wire: 'images', limit: 4}), /最多 3 张/);
});

test('图库编号和图片数据按已验证字段分开，不混进角色', async () => {
  const plan = await planStillReferences([
    {name: '图库人物', imageLibraryId: LIBRARY},
    {name: '样例道具', type: '道具', src: prop},
  ], {wire: 'images'});
  assert.deepEqual(plan.imageReferences, [{id: LIBRARY}, {dataUrl: prop}]);
  assert.deepEqual(Object.keys(plan.imageReferences[0]), ['id']);
  assert.deepEqual(Object.keys(plan.imageReferences[1]), ['dataUrl']);
  const html = renderStillCompare({plan});
  assert.match(html, new RegExp(LIBRARY));
  assert.match(html, /请求只带图库编号/);
  await assert.rejects(() => planStillReferences([
    {name: '重复样例', imageLibraryId: LIBRARY, src: person},
  ], {wire: 'images'}), /没有替你选择/);
  const still = await planStillReferences([
    {name: '样例人物', id: LIBRARY, src: person},
  ], {wire: 'still'});
  assert.deepEqual(still.stillRefs, [person]);
  assert.equal(JSON.stringify(stillRequestBody({prompt: '一场戏', plan: still})).includes(LIBRARY), false);
});

test('外部地址、坏图和读失败都会停下来，并且不会自己去拉取', async () => {
  const remote = 'https://example.invalid/ref.png';
  let calls = 0;
  const read = () => { calls += 1; return person; };
  const origin = 'https://zinc-raven-rocket-drift.grok.me';
  await assert.rejects(() => planStillReferences([{name: '外链样例', src: remote}], {wire: 'still', origin, read}), /外链样例/);
  assert.equal(calls, 0);
  for (const src of ['file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1/a.png', 'http://169.254.169.254/latest', 'http://10.0.0.8/a.png']) {
    calls = 0;
    await assert.rejects(() => planStillReferences([{name: '危险样例', src}], {wire: 'still', origin, read}), /危险样例/);
    assert.equal(calls, 0, src);
  }
  const preview = classifyStillReferences([{name: '外链样例', src: remote}], {wire: 'still', origin});
  const html = renderStillCompare({plan: preview});
  assert.equal(html.includes(`src="${remote}"`), false);
  assert.match(html, /没有发送/);
  await assert.rejects(() => planStillReferences([{name: '动图样例', src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs='}], {wire: 'still', read}), /不是 PNG、JPEG 或 WebP/);
  assert.equal(calls, 0);
  const huge = `data:image/png;base64,${'A'.repeat(1048580)}`;
  await assert.rejects(() => planStillReferences([{name: '过大样例', src: huge}], {wire: 'still'}), /超过 768KB/);
  await assert.rejects(() => planStillReferences([
    {name: '样例道具', src: prop},
    {name: '外链样例', src: remote},
  ], {wire: 'still', origin, read}), /外链样例/);
  assert.equal(calls, 0);
  await assert.rejects(() => planStillReferences([{name: '本站图', src: '/api/images?action=content&id=abc'}], {
    wire: 'still',
    origin,
    read: () => { throw Error('403'); },
  }), /403/);
  await assert.rejects(() => planStillReferences([{name: '空样例', src: ''}], {wire: 'still'}), /没有可读的图片/);
  const loaded = await planStillReferences([{name: '本站图', src: '/api/images?action=content&id=abc'}], {
    wire: 'still',
    origin,
    read: (ref) => { calls += 1; assert.equal(ref.src, '/api/images?action=content&id=abc'); return person; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(loaded.stillRefs, [person]);
  calls = 0;
  const blobbed = await planStillReferences([{name: '浏览器图', src: 'blob:https://zinc-raven-rocket-drift.grok.me/11111111-1111-4111-8111-111111111111'}], {
    wire: 'still',
    read: () => person,
  });
  assert.deepEqual(blobbed.stillRefs, [person]);
});

test('样例页对照的是未盖章色块，外链不会进图片地址', async () => {
  const {demoState} = await import('../pages/still-preview-fixture.mjs');
  const state = await demoState();
  assert.equal(state.bytesSame, true);
  assert.equal(state.done.output, state.output);
  assert.equal(state.done.seqLabel, '2');
  assert.equal(state.blocked.ok, false);
  assert.deepEqual(state.blocked.stillRefs, []);
  const html = renderStillCompare({plan: state.blocked, run: state.retry});
  assert.equal(html.includes('src="https://example.invalid/ref.png"'), false);
  assert.match(html, /上一张结果还在/);
  assert.match(html, /外链样例/);
});

test('失败和重试留着上一张结果，新结果也不盖编号', () => {
  let run = createStillRun();
  run = beginAttempt(run);
  assert.equal(run.status, 'running');
  assert.equal(run.attempt, 1);
  run = failAttempt(run, Error('出图失败'));
  assert.equal(run.output, '');
  assert.match(run.error, /出图失败/);
  run = beginAttempt(run);
  run = finishAttempt(run, output, '2');
  assert.equal(run.output, output);
  assert.equal(run.seqLabel, '2');
  run = beginAttempt(run);
  assert.equal(run.status, 'running');
  assert.equal(run.output, output);
  assert.throws(() => beginAttempt(run), /还在生成/);
  run = failAttempt(run, Error('第二次失败'));
  assert.equal(run.status, 'failed');
  assert.equal(run.output, output);
  assert.equal(run.seqLabel, '2');
  const plan = classifyStillReferences([{name: '样例人物', type: '人物', src: person}], {wire: 'still'});
  const html = renderStillCompare({plan, run});
  assert.match(html, /data-still-status="failed"/);
  assert.match(html, /用同一批参考重试/);
  assert.match(html, /上一张结果还在/);
  assert.match(html, /<span class="still-seq">2<\/span>/);
  const shown = html.match(/data-still-output[\s\S]*?<img src="([^"]+)"/);
  assert.equal(shown[1], output);
  assert.throws(() => failAttempt(createStillRun(), 'x'), /没有进行中的生成/);
});

function sha12(dataUrl) {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex').slice(0, 12);
}

function blobFrom(dataUrl) {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  return new Blob([bytes], {type: mime});
}

test('本节点图片在前，连线图片按边的顺序接在后面，最多 3 张', () => {
  const assets = {
    own1: {id: 'own1', kind: 'image', name: '自己', src: prop},
    own2: {id: 'own2', kind: 'image', name: '自己二', src: person},
    upResult: {id: 'upResult', kind: 'image', name: '上游成图', src: place},
    upRef: {id: 'upRef', kind: 'image', name: '上游参考', src: output},
    later: {id: 'later', kind: 'image', name: '后一条', src: prop},
    clip: {id: 'clip', kind: 'video', name: '视频', src: 'data:video/mp4;base64,AAAA'},
  };
  const lookup = id => assets[id];
  const got = collectStillRefs({
    node: {assetIds: ['own1', 'clip', 'own1']},
    edges: [
      {from: {resultAssetId: 'upResult', assetIds: ['upRef', 'own1']}},
      {from: {resultAssetId: '', assetIds: ['later']}},
    ],
    lookup,
  });
  assert.deepEqual(got.refs.map(item => item.id), ['own1', 'upResult', 'upRef']);
  assert.deepEqual(got.omitted, ['后一条']);
  const edgesOnly = collectStillRefs({
    node: {assetIds: []},
    edges: [
      {from: {assetIds: ['later']}},
      {from: {resultAssetId: 'upResult', assetIds: ['upRef']}},
    ],
    lookup,
  });
  assert.deepEqual(edgesOnly.refs.map(item => item.id), ['later', 'upResult', 'upRef']);
  const capped = assembleStillRefs({
    own: [assets.own1, assets.own2],
    edges: [[assets.upResult], [assets.later]],
    limit: 3,
  });
  assert.deepEqual(capped.refs.map(item => item.id), ['own1', 'own2', 'upResult']);
  assert.deepEqual(capped.omitted, ['后一条']);
});

test('同源引用在发送前读成 data URL，失败就停住并且不组请求', async () => {
  const origin = 'https://zinc-raven-rocket-drift.grok.me';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, credentials: init?.credentials});
    if (String(url).includes('missing')) return {ok: false, status: 404, blob: async () => blobFrom(person)};
    return {ok: true, status: 200, blob: async () => blobFrom(person)};
  };
  const sources = [
    '/api/collaboration?action=media&id=abc',
    '/api/images?action=content&id=abc',
    'blob:https://zinc-raven-rocket-drift.grok.me/11111111-1111-4111-8111-111111111111',
    `${origin}/api/images?action=content&id=abc`,
  ];
  for (const src of sources) {
    calls.length = 0;
    const loaded = await readStillRefSource(src, {origin, name: '样例', fetchImpl});
    assert.equal(loaded, person);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].credentials, 'same-origin');
    assert.equal(calls[0].url, src.startsWith('https:') ? src : src);
  }
  assert.equal(stillRefFetchTarget('https://example.invalid/ref.png', origin).ok, false);
  calls.length = 0;
  await assert.rejects(() => readStillRefSource('https://example.invalid/ref.png', {origin, name: '外链样例', fetchImpl}), /外链样例/);
  assert.equal(calls.length, 0);
  await assert.rejects(() => readStillRefSource('/api/collaboration?action=media&id=missing', {
    origin,
    name: '协作图',
    fetchImpl,
  }), /协作图[\s\S]*没有发送/);
  let posted = 0;
  await assert.rejects(() => planStillReferences([{name: '协作图', src: '/api/images?action=content&id=missing'}], {
    wire: 'still',
    origin,
    read: ref => readStillRefSource(ref.src, {origin, name: ref.name, fetchImpl}),
  }), /没有发送/);
  assert.equal(posted, 0);
  const blocked = classifyStillReferences([{name: '协作图', src: '/api/images?action=content&id=missing'}], {wire: 'still', origin});
  assert.equal(blocked.ok, false);
  assert.throws(() => stillRequestBody({prompt: '一场戏', plan: blocked, resolution: '2K'}), /还不能发送/);
  const html = renderStillNodeError('参考图「协作图」读取失败（404）。没有发送');
  assert.match(html, /role="alert"/);
  assert.match(html, /data-still-node-error/);
  assert.equal(html.includes('data:'), false);
  const ready = await planStillReferences([{name: '协作图', src: '/api/collaboration?action=media&id=abc'}], {
    wire: 'still',
    origin,
    read: ref => readStillRefSource(ref.src, {origin, name: ref.name, fetchImpl}),
  });
  assert.deepEqual(ready.stillRefs, [person]);
  const body = stillRequestBody({prompt: '一场戏', plan: ready, meta: {role: '人物', seed: 7}, resolution: '2K'});
  assert.equal(body.resolution, '2k');
  assert.equal(Object.hasOwn(body, 'role'), false);
  assert.equal(Object.hasOwn(body, 'seed'), false);
});

test('清晰度按节点选项映射，4K 不发送，演练只显示摘要', async () => {
  assert.deepEqual([...STILL_WIRE_RESOLUTIONS], ['1k', '2k']);
  const plan = await planStillReferences([{name: '样例人物', src: person}], {wire: 'still'});
  assert.equal(stillRequestBody({prompt: '一场戏', plan, resolution: '1K'}).resolution, '1k');
  assert.equal(stillRequestBody({prompt: '一场戏', plan, resolution: '2K'}).resolution, '2k');
  assert.equal(stillRequestBody({prompt: '一场戏', plan, resolution: '4K'}).resolution, '2k');
  assert.equal(stillRequestBody({prompt: '一场戏', plan, meta: {resolution: '2K'}}).resolution, '2k');
  const four = mapStillResolution('4K');
  assert.equal(four.enabled, false);
  assert.equal(four.wire, '2k');
  assert.match(four.label, /实际按 2K/);
  const option = stillResolutionOptions().find(item => item.value === '4K');
  assert.equal(option.enabled, false);
  assert.match(option.label, /2K/);
  const summary = await rehearseStillRequest({
    prompt: '一场戏',
    ratio: '16:9',
    plan,
    resolution: '2K',
    omitted: ['后一条'],
  });
  assert.equal(summary.sent, false);
  assert.equal(summary.count, 1);
  assert.equal(summary.resolution, '2k');
  assert.equal(summary.order[0].i, 1);
  assert.equal(summary.order[0].format, 'image/png');
  assert.equal(summary.order[0].bytes, (await digestStillRef(person)).bytes);
  assert.equal(summary.order[0].sha256, sha12(person));
  assert.equal(summary.order[0].sha256.length, 12);
  const packed = JSON.stringify(summary);
  assert.equal(packed.includes('data:'), false);
  assert.equal(packed.includes('base64'), false);
  assert.equal(packed.includes(person.slice(0, 24)), false);
  const html = renderStillRehearsal(summary);
  assert.match(html, /演练（未发送）/);
  assert.match(html, /参考 1 张/);
  assert.match(html, /分辨率 2k/);
  assert.match(html, new RegExp(summary.order[0].sha256));
  assert.match(html, /未纳入：后一条/);
  assert.equal(html.includes('data:'), false);
  assert.equal(html.includes('base64'), false);
});

test('预览站补丁在演练返回之后才调用静帧生成', () => {
  const patch = fs.readFileSync(new URL('../docs/zinc-bench-still-refs.patch', import.meta.url), 'utf8');
  const app = patch.slice(patch.indexOf('diff -ruN a/app.mjs'), patch.indexOf('diff -ruN a/image-node.mjs'));
  const image = patch.slice(patch.indexOf('diff -ruN a/image-node.mjs'), patch.indexOf('diff -ruN a/seq-stamp.mjs'));
  const added = (text) => text.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
  const site = added(app);
  const rehearse = site.indexOf('if(extra.rehearse)return');
  const post = site.indexOf("fetch('/api/pianchang-still'");
  assert.ok(rehearse > 0 && post > rehearse);
  assert.doesNotMatch(site, /resolution:'1k'/);
  assert.match(added(image), /演练（不发送）/);
  assert.match(site, /data-act="image-still-dry"/);
  assert.match(site, /collectStillRefs\(\{node:n,edges:incoming/);
  assert.match(patch, /4K（实际按 2K 出图）/);
  assert.match(added(image), /disabled title=/);
  assert.match(patch, /data-still-node-error/);
});
