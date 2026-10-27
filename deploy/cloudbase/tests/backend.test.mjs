import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBackend, WORKER_ORIGIN, BODY_LIMITS} from '../backend.mjs';
import {hashPassword} from '../../lib/security.mjs';

const ORIGIN = 'https://studio.example';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xc1sAAAAASUVORK5CYII=';
const USER = {id: 'user-a', name: '验收账号', phone: '13900000000', role: 'admin', active: true, session_version: 1};
function req(path, {method = 'GET', body, headers = {}} = {}) {
  return new Request(ORIGIN + path, {method, headers: {Origin: ORIGIN, ...headers}, ...(body === undefined ? {} : {body})});
}
const session = {'Cookie': '__Host-jbp-session=synthetic-session', 'Content-Type': 'application/json'};

test('all eight live handlers load and keep their actual method, status, query and MIME behavior', async () => {
  const backend = await createBackend({query: async () => [], publicOrigin: ORIGIN, env: {}});
  assert.equal((await backend(req('/api/accounts?action=me'))).status, 200);
  for (const path of ['/api/generation?action=jobs', '/api/assets?action=list', '/api/collaboration?action=rooms', '/api/images?action=status', '/api/quota?action=status']) {
    const response = await backend(req(path));
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
  const sso = await backend(req('/api/sso?action=ticket', {method: 'POST', body: JSON.stringify({challenge: 'a'.repeat(43)})}));
  assert.equal(sso.status, 401);
  const reference = await backend(req('/api/reference?id=' + encodeURIComponent('电影叙事')));
  assert.equal(reference.status, 307);
  assert.equal(reference.headers.get('location'), '/shot-reference/' + encodeURIComponent('电影叙事') + '.jpg');
  assert.equal((await backend(req('/api/unknown'))).status, 404);
  assert.equal((await backend(req('/api/images?action=status', {method: 'PUT', body: '{}'}))).status, 405);
});

test('the existing exact-origin and server-to-server redemption boundaries remain enforced', async () => {
  const backend = await createBackend({query: async () => [], publicOrigin: ORIGIN, env: {}});
  for (const request of [
    new Request('https://evil.example/api/accounts?action=me'),
    req('/api/accounts?action=me', {headers: {Origin: 'https://evil.example'}}),
    req('/api/accounts?action=me', {headers: {'Sec-Fetch-Site': 'cross-site'}}),
    new Request(ORIGIN + '/api/accounts?action=login', {method: 'POST', body: '{}'}),
  ]) assert.equal((await backend(request)).status, 403);
  assert.equal((await backend(new Request(ORIGIN + '/api/sso?action=redeem', {method: 'POST', body: '{}'}))).status, 400);
  for (const action of ['poll', 'heartbeat', 'complete']) assert.equal((await backend(req('/api/generation?action=' + action, {method: 'POST', body: '{}'}))).status, 404);
  await assert.rejects(createBackend({query: async () => [], publicOrigin: ORIGIN + '/', env: {}}), /Exact HTTPS origin/);
});

test('actual login retains its Secure HttpOnly cookie and account identity without upstream data', async () => {
  const encoded = await hashPassword('member12');
  const statements = [];
  const backend = await createBackend({publicOrigin: ORIGIN, env: {}, query: async (sql, params) => {
    statements.push([sql, params]);
    if (sql.includes('RETURNING attempts')) return [{attempts: 1}];
    if (sql.includes('WHERE phone=$1')) return [{...USER, password_hash: encoded}];
    return [];
  }});
  const response = await backend(req('/api/accounts?action=login', {method: 'POST', headers: session, body: JSON.stringify({phone: USER.phone, password: 'member12'})}));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /^__Host-jbp-session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  assert.equal((await response.json()).user.id, USER.id);
  assert.ok(statements.some(([sql]) => sql.startsWith('INSERT INTO studio_sessions')));
});

test('actual image content is binary and download headers survive the adapter', async () => {
  const id = '71d885b0-13c0-43ef-b17f-47c728632654';
  const backend = await createBackend({publicOrigin: ORIGIN, env: {}, query: async sql => {
    if (sql.includes('FROM studio_sessions')) return [USER];
    if (sql.startsWith('SELECT i.*')) return [{id, data_url: PNG, name: '角色正面'}];
    throw Error('Unexpected query');
  }});
  const response = await backend(req('/api/images?action=content&id=' + id + '&download=1', {headers: session}));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(PNG.split(',')[1], 'base64'));
});

test('authenticated image workspace and quota status use current handlers without disclosing server configuration', async () => {
  const backend = await createBackend({publicOrigin: ORIGIN, env: {AI_API_KEY: 'test-server-only-key', AI_BASE_URL: 'https://model.example/v1', AI_IMAGE_MODEL: 'server-only-model'}, query: async sql => {
    if (sql.includes('FROM studio_sessions')) return [USER];
    if (sql.startsWith('SELECT id FROM studio_accounts')) return [{id: USER.id}];
    if (sql.startsWith('SELECT image,video_second')) return [{image: 2000, video_second: 1000}];
    if (sql.startsWith('SELECT w.allowance')) return [{allowance: 9000, used: 1000, held: 2000}];
    return [];
  }});
  const images = await backend(req('/api/images?action=status', {headers: session}));
  assert.equal(images.status, 200);
  const status = await images.json();
  assert.equal(status.configured, true);
  assert.deepEqual(status.wallet, {allowance: 9000, used: 1000, held: 2000, available: 6000});
  assert.doesNotMatch(JSON.stringify(status), /test-server-only-key|server-only-model|model\.example/);
  const workspace = await backend(req('/api/images?action=workspace&projectId=project-a', {headers: session}));
  assert.equal(workspace.status, 200);
  assert.equal((await workspace.json()).version, 0);
  const quota = await backend(req('/api/quota?action=status', {headers: session}));
  assert.equal(quota.status, 200);
  assert.equal((await quota.json()).wallet.available, 6000);
});

test('both Mac configuration formats retain the existing shared-queue origin', async () => {
  const backend = await createBackend({publicOrigin: ORIGIN, env: {}, query: async sql => {
    if (sql.includes('FROM studio_sessions')) return [USER];
    if (sql.startsWith('SELECT id,label FROM studio_grok_accounts')) return [{id: 'worker-a', label: '语言模型写作主机'}];
    return [];
  }});
  for (const action of ['worker-config', 'script-worker-config']) {
    const response = await backend(req('/api/generation?action=' + action, {method: 'POST', headers: session, body: JSON.stringify({grokAccountId: 'worker-a'})}));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.config.origin, WORKER_ORIGIN);
    assert.equal(data.config.workerToken.length, 43);
  }
});

test('text submission uses the quota service instead of an unmetered task insert', async () => {
  const statements = [];
  let jobReads = 0;
  const backend = await createBackend({publicOrigin: ORIGIN, env: {}, query: async (sql, params) => {
    statements.push([sql, params]);
    if (sql.includes('FROM studio_sessions')) return [USER];
    if (sql.startsWith('SELECT id FROM studio_grok_accounts')) return [{id: 'worker-a'}];
    if (sql.startsWith('SELECT * FROM studio_generation_jobs WHERE owner=')) return jobReads++ ? [{id: 'job-a', prompt: '验收文本', status: 'queued', created: 0, updated: 0}] : [];
    if (sql.startsWith('SELECT seen FROM studio_generation_workers')) return [{seen: Date.now()}];
    if (sql.startsWith('SELECT count(*)')) return [{n: 0}];
    return [];
  }});
  const response = await backend(req('/api/generation?action=submit', {method: 'POST', headers: session, body: JSON.stringify({grokAccountId: 'worker-a', prompt: '验收文本', requestId: 'test-request'})}));
  assert.equal(response.status, 201);
  assert.ok(statements.some(([sql]) => sql.startsWith('SELECT studio_quota_text_submit(')));
  assert.ok(!statements.some(([sql]) => sql.startsWith('INSERT INTO studio_generation_jobs')));
});

test('image request boundary accepts more than 2.3 MB while ordinary requests remain bounded', async () => {
  const backend = await createBackend({publicOrigin: ORIGIN, env: {}, query: async sql => sql.includes('FROM studio_sessions') ? [USER] : []});
  const body = ' '.repeat(BODY_LIMITS.other) + '{}';
  assert.equal((await backend(req('/api/images?action=workspace', {method: 'POST', headers: session, body}))).status, 400);
  assert.equal((await backend(req('/api/collaboration?action=rooms', {method: 'POST', headers: session, body}))).status, 413);
  const oversized = ' '.repeat(BODY_LIMITS.image + 1);
  assert.equal((await backend(req('/api/images?action=import', {method: 'POST', headers: session, body: oversized}))).status, 413);
});
