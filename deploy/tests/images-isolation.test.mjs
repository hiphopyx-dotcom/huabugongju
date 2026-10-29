// Independent acceptance tests: a real in-memory PostgreSQL engine, the shipped
// migrations, session cookies, and a synthetic image generator. No network/keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {hash} from '../lib/security.mjs';
import {createAssetHandler} from '../lib/assets.mjs';
import {createImageHandler} from '../lib/images.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2hS8AAAAASUVORK5CYII=';
const SECOND_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVQIHWP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const APP = 'https://jubaopeng-canvas.vercel.app';
const identities = [['alice', 'user', '13900000001'], ['bob', 'user', '13900000002'], ['admin', 'admin', '13800000000']];

async function fixture(t, generate = async () => ({dataUrl: PNG})) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../migrations/estimated-token-quota.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../image-schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../migrations/mac-image-worker.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  for (const [id, role, phone] of identities) {
    await db.query('INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES($1,$2,$3,$4,$5,$6)', [id, phone, id, 'test-only-unused', role, now]);
    await db.query('INSERT INTO studio_sessions(token_hash,user_id,version,expires) VALUES($1,$2,1,$3)', [hash('session-' + id), id, now + 3600000]);
    await db.query('INSERT INTO studio_quota_wallets(owner,allowance,updated) VALUES($1,100000,$2)', [id, now]);
  }
  const calls = [];
  const query = async (sql, params) => (await db.query(sql, params)).rows;
  const images = createImageHandler(query, {key: 'test-only-key', baseUrl: 'https://private-upstream.invalid', model: 'private-model-name', now: () => now,
    generate: async options => {calls.push(options); return generate(options);}});
  const assets = createAssetHandler(query);
  const send = (handler, endpoint, action, body, user = 'alice', origin = APP) => handler(new Request(APP + '/api/' + endpoint + '?action=' + action, {
    method: body === undefined ? 'GET' : 'POST', headers: {Origin: origin, Cookie: '__Host-jbp-session=session-' + user, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return {db, calls, now, query,
    request: (action, body, user, origin) => send(images, 'images', action, body, user, origin),
    asset: (action, body, user = 'admin') => send(assets, 'assets', action, body, user),
    async wallet(owner = 'alice') {
      const rows = (await db.query('SELECT request_key,kind,state,reserved,charged FROM studio_quota_entries WHERE owner=$1 ORDER BY request_key', [owner])).rows;
      return {rows, charged: rows.reduce((n, row) => n + Number(row.charged), 0), held: rows.reduce((n, row) => n + (row.state === 'reserved' ? Number(row.reserved) : 0), 0)};
    },
  };
}

const generatePayload = (overrides = {}) => ({requestId: randomUUID(), projectId: 'project-alice', projectTitle: '自己的作品', name: '角色参考', kind: '角色',
  prompt: '人物站在门房窗前，保持服装一致。', ratio: '9:16', resolution: '1k', references: [], ...overrides});
const importPayload = (overrides = {}) => ({requestId: randomUUID(), projectId: 'project-alice', projectTitle: '自己的作品', name: '历史角色图', kind: '角色', dataUrl: PNG,
  sourceId: 'original-image-1', sourceProjectTitle: '原作品', ...overrides});
async function json(response) {
  const value = await response.json();
  assert.ok(response.status < 400, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}
function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /test-only-key|private-upstream|private-model-name|grok|x\.ai|provider|password_hash|token_hash|workerToken|lease_hash|user_id|grok_account_id/i);
  assert.equal(hasKey(value, new Set(['owner', 'accountId', 'apiKey', 'api_key'])), false);
}
function hasKey(value, names) {
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => names.has(key) || hasKey(child, names));
}

test('image ownership comes from the canvas session; another account cannot read media or choose its owner', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('list', undefined, 'missing')).status, 401);
  assert.equal((await f.request('generate', generatePayload(), 'alice', 'https://attacker.invalid')).status, 403);
  for (const extra of [{owner: 'bob'}, {accountId: 'bob'}, {grokAccountId: 'other'}]) {
    assert.ok((await f.request('generate', generatePayload(extra))).status >= 400);
  }
  assert.equal(f.calls.length, 0);
  const created = await json(await f.request('generate', generatePayload()));
  assert.equal(created.job.status, 'done');
  assert.ok(created.item.id);
  assertPrivate(created);
  const mine = await json(await f.request('list'));
  assert.equal(mine.items.length, 1);
  assertPrivate(mine);
  const other = await json(await f.request('list', undefined, 'bob'));
  assert.equal(other.items.length, 0);
  assert.equal((await f.request('content&id=' + encodeURIComponent(created.item.id), undefined, 'bob')).status, 404);
  const content = await f.request('content&id=' + encodeURIComponent(created.item.id));
  assert.equal(content.status, 200);
  assert.match(content.headers.get('content-type'), /^image\/png/);
  assert.ok((await content.arrayBuffer()).byteLength > 16);
  assert.equal(content.headers.get('location'), null);
});

test('an image completing after A switches to B remains visible and charged only to A', async t => {
  let resolveImage, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {resolveImage = resolve;});});
  const request = generatePayload();
  const pending = f.request('generate', request, 'alice');
  await entered;
  const before = await json(await f.request('list', undefined, 'bob'));
  assert.equal(before.items.length, 0);
  assert.equal((await f.wallet('alice')).held, 2000);
  assert.equal((await f.wallet('bob')).held, 0);
  resolveImage({dataUrl: PNG});
  const completed = await json(await pending);
  assert.equal(completed.job.status, 'done');
  assert.equal((await json(await f.request('list', undefined, 'bob'))).items.length, 0);
  assert.equal((await f.request('content&id=' + completed.item.id, undefined, 'bob')).status, 404);
  assert.equal((await json(await f.request('list', undefined, 'alice'))).items.length, 1);
  assert.equal((await f.wallet('alice')).charged, 2000);
  assert.deepEqual((await f.wallet('bob')).rows, []);
});

test('concurrent and repeated generation requests execute once, create one asset and settle one reservation', async t => {
  let resolveImage, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {resolveImage = resolve;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  const duplicate = await f.request('generate', payload);
  assert.ok(duplicate.status < 500, 'an in-flight replay must not crash');
  assert.equal(f.calls.length, 1);
  resolveImage({dataUrl: PNG});
  const original = await json(await pending);
  const replay = await json(await f.request('generate', payload));
  assert.equal(replay.item.id, original.item.id);
  assert.equal(f.calls.length, 1);
  assert.equal((await json(await f.request('list'))).items.length, 1);
  const wallet = await f.wallet();
  assert.equal(wallet.rows.length, 1);
  assert.equal(wallet.charged, 2000);
  assert.equal(wallet.held, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_asset_records WHERE owner=$1', ['alice'])).rows[0].n, 1);
  assert.equal((await f.request('generate', {...payload, prompt: '同一个请求标识换了提示词'})).status, 409);
  assert.equal(f.calls.length, 1);
});

test('definite failures release quota, while uncertain results keep the hold and never retry the upstream automatically', async t => {
  const f = await fixture(t, ({prompt}) => {
    if (prompt === 'definite') throw Object.assign(new Error('private-upstream.invalid test-only-key'), {definite: true});
    throw new Error('private-model-name connection reset after submission');
  });
  const definite = generatePayload({prompt: 'definite'});
  const failed = await json(await f.request('generate', definite));
  assert.equal(failed.job.status, 'failed');
  assertPrivate(failed);
  assert.equal((await f.wallet()).held, 0);
  assert.equal((await f.wallet()).charged, 0);
  const uncertain = generatePayload({prompt: 'uncertain'});
  const pending = await json(await f.request('generate', uncertain));
  assert.equal(pending.job.status, 'uncertain');
  assertPrivate(pending);
  const result = await json(await f.request('generate', uncertain));
  assert.equal(result.job.status, 'uncertain');
  assert.equal(f.calls.length, 2, 'one definite attempt and one uncertain attempt, with no retry');
  assert.equal((await f.wallet()).held, 2000);
  assert.equal((await f.wallet()).charged, 0);
  assert.equal((await json(await f.request('list'))).items.length, 0);
});

test('historical import never generates or consumes quota and deduplicates by the original image identity', async t => {
  const f = await fixture(t, () => assert.fail('a historical image must not invoke generation'));
  await f.db.query('UPDATE studio_quota_wallets SET allowance=0 WHERE owner=$1', ['alice']);
  const payload = importPayload();
  const first = await json(await f.request('import', payload));
  const again = await json(await f.request('import', {...payload, requestId: randomUUID()}));
  assert.equal(first.item.id, again.item.id);
  assert.equal((await json(await f.request('list'))).items.length, 1);
  assert.deepEqual((await f.wallet()).rows, []);
  assert.equal(f.calls.length, 0);
  assertPrivate(first);
  const changed = await f.request('import', {...payload, requestId: randomUUID(), dataUrl: SECOND_PNG});
  assert.equal(changed.status, 409, 'one old image identity cannot silently replace different media');
  const bob = await json(await f.request('import', {...payload, projectId: 'project-bob'}, 'bob'));
  assert.notEqual(bob.item.id, first.item.id);
  assert.deepEqual((await f.wallet('bob')).rows, []);
  assert.ok((await f.request('import', {...payload, requestId: randomUUID(), owner: 'bob'})).status >= 400);
});

test('administrator locks and deletion are enforced by the shared asset record and stale import cannot resurrect media', async t => {
  const f = await fixture(t);
  const payload = importPayload();
  const imported = await json(await f.request('import', payload));
  const row = (await f.db.query('SELECT * FROM studio_asset_records WHERE owner=$1', ['alice'])).rows[0];
  assert.ok(row, 'an image must also register in the existing administrator asset controls');
  const target = {source: 'asset', owner: 'alice', projectId: row.project_id, id: row.asset_id, revision: 0, operation: 'lock'};
  assert.equal((await f.asset('manage', target, 'alice')).status, 403);
  assert.equal((await f.asset('manage', target)).status, 200);
  const locked = await json(await f.request('list'));
  assert.equal(locked.items[0].adminLocked, true);
  assert.equal((await f.request('content&id=' + imported.item.id)).status, 200);
  assert.equal((await f.asset('manage', {...target, revision: 1, operation: 'delete'})).status, 409);
  await f.asset('sync', {accountId: 'alice', projectId: row.project_id, projectTitle: '试图改写项目名', assets: [{id: row.asset_id, name: '试图覆盖', kind: 'image', provenance: 'local', prompt: '试图覆盖', preview: '', created: f.now}]}, 'alice');
  assert.equal((await f.db.query('SELECT name FROM studio_asset_records WHERE owner=$1 AND asset_id=$2', ['alice', row.asset_id])).rows[0].name, row.name);
  assert.equal((await f.asset('manage', {...target, revision: 1, operation: 'unlock'})).status, 200);
  assert.equal((await f.asset('manage', {...target, revision: 2, operation: 'delete'})).status, 200);
  assert.equal((await json(await f.request('list'))).items.length, 0);
  assert.equal((await f.request('content&id=' + imported.item.id)).status, 404);
  assert.ok((await f.request('import', {...payload, requestId: randomUUID()})).status >= 400);
  assert.equal((await json(await f.request('list'))).items.length, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_asset_records WHERE owner=$1', ['alice'])).rows[0].n, 1);
  assert.equal((await f.asset('manage', {...target, revision: 3, operation: 'restore'})).status, 200);
  assert.equal((await json(await f.request('list'))).items.length, 1);
  assert.equal((await f.request('content&id=' + imported.item.id)).status, 200);
});

test('pagination returns all same-timestamp images once and filters out another owner', async t => {
  const f = await fixture(t);
  const ids = [];
  for (let i = 0; i < 31; i++) {
    const created = await json(await f.request('import', importPayload({sourceId: 'history-' + i, name: '历史图片' + i})));
    ids.push(created.item.id);
  }
  await json(await f.request('import', importPayload({sourceId: 'only-bob'}), 'bob'));
  const first = await json(await f.request('list&page=1&pageSize=24'));
  const second = await json(await f.request('list&page=2&pageSize=24'));
  assert.equal(first.total, 31);
  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, 7);
  const found = [...first.items, ...second.items].map(item => item.id);
  assert.equal(new Set(found).size, 31);
  assert.deepEqual(found.sort(), ids.sort());
  assertPrivate(first); assertPrivate(second);
  assert.ok((await f.request('list&page=0')).status >= 400);
  assert.ok((await f.request('list&pageSize=25')).status >= 400);
});

test('insufficient quota and untrusted media inputs fail before any upstream call or partial asset write', async t => {
  const f = await fixture(t);
  await f.db.query('UPDATE studio_quota_wallets SET allowance=1999 WHERE owner=$1', ['alice']);
  assert.equal((await f.request('generate', generatePayload())).status, 409);
  assert.equal(f.calls.length, 0);
  assert.deepEqual((await f.wallet()).rows, []);
  const invalid = [
    importPayload({dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+'}),
    importPayload({dataUrl: 'https://private-upstream.invalid/image.png'}),
    importPayload({dataUrl: 'data:text/html;base64,PHNjcmlwdD4='}),
  ];
  for (const body of invalid) assert.ok((await f.request('import', body)).status >= 400);
  assert.equal((await json(await f.request('list'))).items.length, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_asset_records')).rows[0].n, 0);
});

test('the same request UUID in two accounts creates and settles distinct account-owned jobs', async t => {
  const f = await fixture(t);
  const payload = generatePayload();
  const alice = await json(await f.request('generate', payload));
  const bob = await json(await f.request('generate', payload, 'bob'));
  assert.notEqual(alice.item.id, bob.item.id);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.wallet('alice')).charged, 2000);
  assert.equal((await f.wallet('bob')).charged, 2000);
  assert.deepEqual((await json(await f.request('list'))).items.map(item => item.id), [alice.item.id]);
  assert.deepEqual((await json(await f.request('list', undefined, 'bob'))).items.map(item => item.id), [bob.item.id]);
  assertPrivate(alice); assertPrivate(bob);
});

test('manual release during generation prevents saving or charging a late result, without another upstream attempt', async t => {
  let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {finish = resolve;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  await f.db.query("SELECT studio_quota_change($1,$2,'release','image',0,'',$3)", ['alice', 'media:image:' + payload.requestId, f.now]);
  finish({dataUrl: PNG});
  const result = await json(await pending);
  assert.equal(result.job.status, 'uncertain');
  assert.equal(result.item, undefined);
  assert.equal((await f.wallet()).charged, 0);
  assert.equal((await f.wallet()).held, 0);
  assert.equal((await f.wallet()).rows[0].state, 'released');
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_images')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_asset_records')).rows[0].n, 0);
  assert.equal((await json(await f.request('generate', payload))).job.status, 'uncertain');
  assert.equal(f.calls.length, 1);
  assertPrivate(result);
});

test('manual charge during generation remains the single settlement when the late image is saved', async t => {
  let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {finish = resolve;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  await f.db.query("SELECT studio_quota_change($1,$2,'charge','image',700,'',$3)", ['alice', 'media:image:' + payload.requestId, f.now]);
  finish({dataUrl: PNG});
  const result = await json(await pending);
  assert.equal(result.job.status, 'done');
  assert.ok(result.item);
  assert.equal((await f.wallet()).charged, 700);
  assert.equal((await f.wallet()).held, 0);
  assert.equal((await f.wallet()).rows.length, 1);
  assert.equal((await json(await f.request('generate', payload))).item.id, result.item.id);
  assert.equal(f.calls.length, 1);
});

test('a definite failure after manual charge does not falsely tell the member the charge was released', async t => {
  let reject, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise((resolve, fail) => {reject = fail;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  await f.db.query("SELECT studio_quota_change($1,$2,'charge','image',700,'',$3)", ['alice', 'media:image:' + payload.requestId, f.now]);
  reject(Object.assign(new Error('private-upstream failure'), {definite: true}));
  const result = await json(await pending);
  assert.equal(result.job.status, 'failed');
  assert.equal((await f.wallet()).charged, 700);
  assert.doesNotMatch(result.job.error, /已释放/);
  assertPrivate(result);
});

test('session revocation while an image is pending discards the result and releases its reservation', async t => {
  let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {finish = resolve;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  await f.db.query('DELETE FROM studio_sessions WHERE user_id=$1', ['alice']);
  finish({dataUrl: PNG});
  const result = await json(await pending);
  assert.equal(result.job.status, 'failed');
  assert.equal(result.item, undefined);
  assert.equal((await f.wallet()).charged, 0);
  assert.equal((await f.wallet()).held, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_images')).rows[0].n, 0);
  assert.equal((await f.request('generate', payload)).status, 401);
  assert.equal(f.calls.length, 1);
});

test('another account cannot use a private reference, and deleting a reference during generation rejects the late result', async t => {
  let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {finish = resolve;});});
  const reference = (await json(await f.request('import', importPayload()))).item;
  assert.equal((await f.request('generate', generatePayload({references: [{id: reference.id}]}), 'bob')).status, 404);
  assert.equal(f.calls.length, 0);
  assert.deepEqual((await f.wallet('bob')).rows, []);
  const payload = generatePayload({references: [{id: reference.id}]});
  const pending = f.request('generate', payload);
  await entered;
  assert.deepEqual(f.calls[0].references, [PNG]);
  assert.equal((await f.asset('manage', {source: 'asset', owner: 'alice', projectId: reference.projectId, id: reference.id, revision: 0, operation: 'delete'})).status, 200);
  finish({dataUrl: PNG});
  const result = await json(await pending);
  assert.equal(result.job.status, 'failed');
  assert.equal(result.item, undefined);
  assert.equal((await f.wallet()).held, 0);
  assert.equal((await f.wallet()).charged, 0);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_images')).rows[0].n, 1);
  assert.equal((await json(await f.request('list'))).items.length, 0);
  assert.equal(f.calls.length, 1);
});

test('a failed asset registration rolls back the image and charge together and leaves an uncertain, non-retried job', async t => {
  let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, () => {started(); return new Promise(resolve => {finish = resolve;});});
  const payload = generatePayload();
  const pending = f.request('generate', payload);
  await entered;
  const job = (await f.db.query('SELECT * FROM studio_image_jobs WHERE owner=$1', ['alice'])).rows[0];
  await f.db.query("INSERT INTO studio_asset_records(owner,project_id,asset_id,project_title,name,kind,provenance,created,synced) VALUES($1,$2,$3,'已有资产','已有资产','image','local',$4,$4)", ['alice', payload.projectId, job.id, f.now]);
  finish({dataUrl: PNG});
  const result = await json(await pending);
  assert.equal(result.job.status, 'uncertain');
  assert.equal(result.item, undefined);
  assert.equal((await f.wallet()).charged, 0);
  assert.equal((await f.wallet()).held, 2000);
  assert.equal((await f.db.query('SELECT count(*) AS n FROM studio_images')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT name FROM studio_asset_records WHERE owner=$1', ['alice'])).rows[0].name, '已有资产');
  assert.equal((await json(await f.request('generate', payload))).job.status, 'uncertain');
  assert.equal(f.calls.length, 1);
});

test('canonical image lock and delete controls follow a reused image into another project, within its owner only', async t => {
  const f = await fixture(t);
  const item = (await json(await f.request('import', importPayload()))).item;
  const target = {source: 'asset', owner: 'alice', projectId: item.projectId, id: item.id, revision: 0, operation: 'lock'};
  assert.equal((await f.asset('manage', target)).status, 200);
  const otherProject = await json(await f.asset('controls&projectId=another-project', undefined, 'alice'));
  assert.deepEqual(otherProject.controls.map(control => control.id), [item.id]);
  assert.equal(otherProject.controls[0].admin_locked, true);
  assert.equal(otherProject.controls[0].admin_deleted, false);
  assert.deepEqual((await json(await f.asset('controls&projectId=another-project', undefined, 'bob'))).controls, []);
  assert.equal((await f.asset('manage', {...target, operation: 'unlock', revision: 1})).status, 200);
  assert.equal((await f.asset('manage', {...target, operation: 'delete', revision: 2})).status, 200);
  const deleted = await json(await f.asset('controls&projectId=another-project', undefined, 'alice'));
  assert.deepEqual(deleted.controls.map(control => control.id), [item.id]);
  assert.equal(deleted.controls[0].admin_deleted, true);
  assert.equal((await f.request('content&id=' + item.id)).status, 404);
  assert.deepEqual((await json(await f.asset('controls&projectId=another-project', undefined, 'bob'))).controls, []);
  assert.equal((await f.asset('manage', {...target, operation: 'restore', revision: 3})).status, 200);
  const restored = await json(await f.asset('controls&projectId=another-project', undefined, 'alice'));
  assert.equal(restored.controls[0].admin_deleted, false);
  assert.equal((await f.request('content&id=' + item.id)).status, 200);
});
