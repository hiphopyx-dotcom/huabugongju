import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {createAccountHandler} from '../lib/accounts.mjs';
import {createSkillHandler} from '../lib/skills.mjs';

function crc32(bytes) {
  let crc = ~0;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function zip(name, text) {
  const fileName = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(text);
  const data = zlib.deflateRawSync(raw);
  const crc = crc32(raw);
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => { n >>>= 0; return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
  const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(fileName.length), ...u16(0), ...fileName, ...data];
  const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(fileName.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...fileName];
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return Buffer.from([...local, ...central, ...end]).toString('base64');
}

async function setup({migrate = true, enabled = true} = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  if (migrate) db.exec(fs.readFileSync(new URL('../migrations/20261101_skills.sql', import.meta.url), 'utf8'));
  let queried = 0;
  const query = async (sql, params) => {
    queried += 1;
    return db.prepare(sql).all(Object.fromEntries(params.map((value, index) => ['$' + (index + 1), typeof value === 'boolean' ? Number(value) : value])));
  };
  const account = createAccountHandler(query, {setupToken: 'skill-test'});
  const skills = createSkillHandler(query, {JBP_SKILLS_ENABLED: enabled ? '1' : ''});
  const callAccount = (action, body) => account(new Request('https://studio.test/api/accounts?action=' + action, {method: 'POST', headers: {Origin: 'https://studio.test', 'Content-Type': 'application/json'}, body: JSON.stringify(body)}));
  let response = await callAccount('bootstrap', {setupToken: 'skill-test', name: '管理员', phone: '13800000000', password: '12345678'});
  const admin = response.headers.get('set-cookie').split(';')[0];
  await account(new Request('https://studio.test/api/accounts?action=users', {method: 'POST', headers: {Origin: 'https://studio.test', Cookie: admin, 'Content-Type': 'application/json'}, body: JSON.stringify({name: '成员', phone: '13900000000', password: '123456'})}));
  response = await account(new Request('https://studio.test/api/accounts?action=login', {method: 'POST', headers: {Origin: 'https://studio.test', 'Content-Type': 'application/json'}, body: JSON.stringify({phone: '13900000000', password: '123456'})}));
  const member = response.headers.get('set-cookie').split(';')[0];
  const call = (action, body, cookie = '', method = body ? 'POST' : 'GET') => skills(new Request('https://studio.test/api/skills?action=' + action, {method, headers: {Origin: 'https://studio.test', Cookie: cookie, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined}));
  return {db, admin, member, call, queries: () => queried};
}

const pack = extra => ({files: [{path: 'SKILL.md', text: `---\nname: 试招\ndescription: 剑术打斗\n---\n右手持剑，出招后收势。\n`}, {path: 'run.js', text: 'alert(1)'}, ...(extra || [])], confirm: true, category: 'fight', stages: ['video']});

test('开关关闭时不查库；非管理员不能导入、删除或看总览', async () => {
  const off = await setup({enabled: false, migrate: false});
  try {
    const before = off.queries();
    assert.deepEqual(await (await off.call('status')).json(), {enabled: false});
    assert.equal((await off.call('import', pack(), off.admin)).status, 404);
    assert.equal((await off.call('overview', null, off.admin)).status, 404);
    assert.equal(off.queries(), before);
  } finally { off.db.close(); }
  const on = await setup();
  try {
    assert.deepEqual(await (await on.call('status')).json(), {enabled: true});
    assert.equal((await on.call('import', pack())).status, 401);
    assert.equal((await on.call('import', pack(), on.member)).status, 403);
    assert.equal((await on.call('overview', null, on.member)).status, 403);
    assert.equal((await on.call('delete', {id: 'x', confirm: true}, on.member)).status, 403);
    assert.equal((await on.call('update', {id: 'x', enabled: false}, on.member)).status, 403);
    assert.equal((await (await on.call('list', null, on.member)).json()).skills.length, 0);
  } finally { on.db.close(); }
});

test('管理员导入会丢掉脚本并预览，成员只能使用已启用技能，次数只追加', async () => {
  const s = await setup();
  try {
    const preview = await (await s.call('preview', pack(), s.admin)).json();
    assert.equal(preview.category, 'fight');
    assert.deepEqual(preview.stages, ['video']);
    assert.ok(preview.dropped.includes('run.js'));
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM studio_skills').get().n, 0);
    const created = await (await s.call('import', pack(), s.admin)).json();
    assert.equal(created.name, '试招');
    let list = await (await s.call('list', null, s.member)).json();
    assert.equal(list.skills.length, 1);
    assert.equal((await s.call('use', {uses: [{skillId: created.id, projectId: 'p1', shotId: 'shot-1', stage: 'video'}]}, s.member)).status, 200);
    assert.equal((await s.call('use', {uses: [{skillId: 'builtin:fight', projectId: 'p1', shotId: '', stage: 'video'}]}, s.member)).status, 200);
    await s.call('update', {id: created.id, enabled: false}, s.admin);
    assert.equal((await s.call('use', {uses: [{skillId: created.id, projectId: 'p1', shotId: 'shot-2', stage: 'video'}]}, s.member)).status, 404);
    list = await (await s.call('list', null, s.member)).json();
    assert.equal(list.skills.length, 0);
    const overview = await (await s.call('overview', null, s.admin)).json();
    const row = overview.skills[0];
    assert.equal(row.enabled, false);
    assert.equal(row.uses, 1);
    assert.equal(row.importedBy, '管理员');
    assert.equal(overview.builtin[0].uses, 1);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM studio_skill_uses').get().n, 2);
    assert.equal((await s.call('delete', {id: created.id, confirm: true}, s.admin)).status, 200);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM studio_skills').get().n, 0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM studio_skill_uses').get().n, 2);
    const slipped = pack([{path: '../secret.md', text: 'nope'}]);
    assert.equal((await s.call('import', slipped, s.admin)).status, 400);
    const hostile = zip('../secret.md', '---\nname: 坏\ndescription: 坏\n---\n');
    assert.equal((await s.call('import', {zipBase64: hostile, confirm: true, category: 'other', stages: ['video']}, s.admin)).status, 400);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM studio_skills').get().n, 0);
  } finally { s.db.close(); }
});

test('技能表还没建时返回 503，不会在请求里建表', async () => {
  const s = await setup({migrate: false});
  try {
    const response = await s.call('list', null, s.admin);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /技能表尚未建立/);
    assert.equal(s.db.prepare("SELECT name FROM sqlite_master WHERE name='studio_skills'").get(), undefined);
  } finally { s.db.close(); }
});
