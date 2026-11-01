import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../lib/security.mjs';
import { createPhoneLoginHandler, createWhoamiHandler, createBackupHandler } from '../lib/phone-access.mjs';
import { smsConfigured, smsStatus, SMS_ENV } from '../lib/sms.mjs';

const origin = 'https://studio.test';
function db() {
  const database = new DatabaseSync(':memory:');
  database.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const query = async (sql, params = []) => database.prepare(sql).all(Object.fromEntries(params.map((value, index) => ['$' + (index + 1), typeof value === 'boolean' ? Number(value) : value])));
  return { database, query };
}
async function seed(query) {
  const now = Date.now();
  const password = await hashPassword('member12');
  await query("INSERT INTO studio_accounts (id,phone,name,password_hash,role,created) VALUES ($1,$2,$3,$4,'user',$5)", ['member', '13900000000', '成员', password, now]);
  await query("INSERT INTO studio_accounts (id,phone,name,password_hash,role,created) VALUES ($1,$2,$3,$4,'user',$5)", ['other', '13900000001', '别人', password, now]);
  await query("INSERT INTO studio_grok_accounts (id,label) VALUES ('grok-1','池')");
  await query("INSERT INTO studio_generation_jobs (id,owner,grok_account_id,session_version,request_key,prompt,status,result,lease_hash,created,updated) VALUES ('job-1','member','grok-1',1,'req-1','只属于成员的稿','done','成稿','lease-secret',$1,$2)", [now, now]);
  await query("INSERT INTO studio_generation_jobs (id,owner,grok_account_id,session_version,request_key,prompt,status,created,updated) VALUES ('job-2','other','grok-1',1,'req-2','别人的稿','done',$1,$2)", [now, now]);
  await query("INSERT INTO studio_asset_records (owner,project_id,asset_id,project_title,name,kind,provenance,prompt,created,synced) VALUES ('member','p','a','片场','镜头','image','local','提示',$1,$2)", [now, now]);
}
function post(path, body, headers = {}) {
  return new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('短信变量缺任意一项就是未配置，不使用默认密钥', () => {
  assert.equal(smsConfigured({}), false);
  assert.equal(smsConfigured({ JBP_SMS_PROVIDER: 'example' }), false);
  const full = Object.fromEntries(SMS_ENV.map(([name]) => [name, 'present']));
  assert.equal(smsConfigured(full), true);
  assert.deepEqual(smsStatus({}).missing, SMS_ENV.map(([name]) => name));
  assert.equal(JSON.stringify(smsStatus({})).includes('jubao-phone-session'), false);
});

test('手机号密码登录复用工作台会话，whoami 认 Bearer 和 cookie', async () => {
  const s = db();
  try {
    await seed(s.query);
    const login = createPhoneLoginHandler(s.query, { setupToken: 'unused', env: {} });
    const who = createWhoamiHandler(s.query);
    const missing = await login(post('/api/phone-login', { action: 'send', phone: '13900000000' }));
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error, '短信服务未配置');
    const bad = await login(post('/api/phone-login', { phone: '13900000000', password: 'wrong-password' }));
    assert.equal(bad.status, 401);
    const ok = await login(post('/api/phone-login', { phone: '13900000000', password: 'member12' }));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.name, '成员');
    assert.equal(body.user.phone, '13900000000');
    assert.ok(body.token);
    assert.match(ok.headers.get('set-cookie'), /__Host-jbp-session=/);
    const bearer = await who(new Request(origin + '/api/whoami', { headers: { Authorization: 'Bearer ' + body.token } }));
    assert.equal((await bearer.json()).user.id, 'member');
    const cookie = await who(new Request(origin + '/api/whoami', { headers: { Cookie: ok.headers.get('set-cookie').split(';')[0] } }));
    assert.equal((await cookie.json()).user.id, 'member');
    assert.equal((await who(new Request(origin + '/api/whoami'))).status, 401);
  } finally { s.database.close(); }
});

test('短信五项都在时也不外呼、不回显密钥', async () => {
  const s = db();
  const secret = 'sms-secret-value';
  try {
    const env = Object.fromEntries(SMS_ENV.map(([name]) => [name, name === 'JBP_SMS_ACCESS_KEY_SECRET' ? secret : 'vendor']));
    const login = createPhoneLoginHandler(s.query, { env });
    const response = await login(post('/api/phone-login', { action: 'send', phone: '13900000000' }));
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.match(text, /短信服务未接入/);
    assert.equal(text.includes(secret), false);
  } finally { s.database.close(); }
});

test('备份只含本人记录，不含密码、租约和别人的稿', async () => {
  const s = db();
  try {
    await seed(s.query);
    const login = createPhoneLoginHandler(s.query, { env: {} });
    const backup = createBackupHandler(s.query);
    assert.equal((await backup(new Request(origin + '/api/backup'))).status, 401);
    const ok = await login(post('/api/phone-login', { phone: '13900000000', password: 'member12' }));
    const token = (await ok.json()).token;
    const file = await backup(new Request(origin + '/api/backup', { headers: { Authorization: 'Bearer ' + token } }));
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition'), /jubaopeng-backup.json/);
    const pack = JSON.parse(await file.text());
    assert.equal(pack.user_id, 'member');
    assert.deepEqual(pack.data.generation_jobs.map(job => job.id), ['job-1']);
    assert.equal(pack.data.generation_jobs[0].prompt, '只属于成员的稿');
    assert.equal(pack.data.asset_records.length, 1);
    const raw = JSON.stringify(pack);
    assert.equal(raw.includes('password_hash'), false);
    assert.equal(raw.includes('lease-secret'), false);
    assert.equal(raw.includes('别人的稿'), false);
  } finally { s.database.close(); }
});

test('没有数据库时三个入口都返回未配置', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const bridge = await import('../api/account-bridge.js');
    for (const request of [
      post('/api/phone-login', { phone: '1', password: 'x' }),
      new Request(origin + '/api/whoami'),
      new Request(origin + '/api/backup'),
    ]) {
      const handler = request.method === 'POST' ? bridge.POST : bridge.GET;
      const response = await handler(request);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, '未配置');
    }
  } finally { if (previous !== undefined) process.env.DATABASE_URL = previous; }
});
