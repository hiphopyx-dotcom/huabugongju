import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {stampSeq, presentSeq, seqText} from '../pages/seq-stamp.mjs';
import {
  STILL_REF_CONTRACT,
  appendRefPrompt,
  beginAttempt,
  classifyStillReferences,
  createStillRun,
  failAttempt,
  finishAttempt,
  planStillReferences,
  renderStillCompare,
  stillRequestBody,
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
