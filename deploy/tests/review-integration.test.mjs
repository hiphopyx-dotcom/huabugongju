import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = load('../../pages/app.mjs');
const config = JSON.parse(load('../vercel.json'));
const schema = load('../schema.sql');

test('legacy review integration retains latest DOCX export and native writing workspace', () => {
  assert.match(app, /导出剧本 DOCX/);
  assert.match(app, /scriptDocxFilename\(P\.title\)/);
  assert.match(app, /'script-task':\(\)=>\{goto\('writing'\);scriptWorkbench\.show\('create'\)/);
  assert.match(app, /from '\.\/script-quality\.mjs\?v=/);
  assert.match(app, /from '\.\/script-review\.mjs\?v=/);
  assert.match(app, /'review-open':\(\)=>review\.open\(\)/);
  assert.match(app, /'script-quality':\(\)=>/);
  assert.match(app, /rememberActiveProject\(\)/);
});

test('review integration retains current local sealed-script protection', () => {
  assert.match(app, /Review\.sealedPartsIntact\(backup,P\.script\)/);
  assert.match(app, /Review\.sealedPartsIntact\(P,el\.value\)/);
  assert.match(app, /if\(Object\.keys\(P\.scriptSeals\|\|\{\}\)\.length\)return toast/);
  assert.match(app, /if\(Object\.keys\(target\?\.scriptSeals\|\|\{\}\)\.length\)return toast/);
});

test('merged server config retains all deployed routes, including images, quota and review', () => {
  for (const key of ['api/accounts.js', 'api/generation.js', 'api/assets.js', 'api/quota.js', 'api/images.js', 'api/review.js']) {
    assert.ok(config.functions[key], key + ' missing');
  }
  assert.equal(config.functions['api/images.js'].maxDuration, 180);
  assert.equal(config.functions['api/review.js'].maxDuration, 30);
});

test('schema additions do not drop account, quota, image or review tables', () => {
  for (const table of ['studio_accounts', 'studio_quota_wallets', 'studio_quota_entries', 'studio_script_reviews']) {
    assert.ok(schema.includes(table), table + ' missing');
  }
});
