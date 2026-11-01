import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'bench-export');
const ZINC = 'https://jubaopeng-zinc.vercel.app';

function run(extra = {}) {
  const env = {...process.env};
  delete env.BENCH_API_BASE;
  Object.assign(env, extra);
  return spawnSync(process.execPath, ['scripts/export-bench.mjs'], {cwd: root, env, encoding: 'utf8'});
}

function indexHtml() {
  return fs.readFileSync(path.join(out, 'index.html'), 'utf8');
}

test('导出的 /bench 连接 zinc 后台，可用 BENCH_API_BASE 覆盖，并保留 Bearer 登录', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = indexHtml();
  assert.ok(html.includes(`<meta name="studio-api-base" content="${ZINC}">`));
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="connect-src 'self' ${ZINC}">`));
  assert.equal(html.includes('jubaopeng-canvas.vercel.app'), false);
  const accounts = fs.readFileSync(path.join(out, 'accounts.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(out, 'api-client.mjs'), 'utf8');
  assert.match(accounts, /client:'bearer'/);
  assert.match(client, /jbp-bench-token/);
  assert.match(client, /'Authorization', 'Bearer '/);

  const custom = 'https://bench.example';
  const ok = run({BENCH_API_BASE: custom});
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const overridden = indexHtml();
  assert.ok(overridden.includes(`<meta name="studio-api-base" content="${custom}">`));
  assert.ok(overridden.includes(`connect-src 'self' ${custom}`));
  assert.equal(overridden.includes(ZINC), false);

  for (const value of ['https://bench.example/api', 'http://bench.example', 'not a url']) {
    const bad = run({BENCH_API_BASE: value});
    assert.notEqual(bad.status, 0, value);
    assert.match(bad.stderr, /BENCH_API_BASE/);
  }

  const restored = run();
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  assert.ok(indexHtml().includes(`<meta name="studio-api-base" content="${ZINC}">`));
});
