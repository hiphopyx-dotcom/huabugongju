import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {apiBase, authToken} from '../public/studio/api-client.mjs';

test('没有预览标记时接口基址为空，不读令牌', () => {
  assert.equal(apiBase(), '');
  assert.equal(authToken(), '');
});

test('接上正式版后台时登录按钮写成登录正式版账号', () => {
  const accounts = fs.readFileSync(new URL('../public/studio/accounts.mjs', import.meta.url), 'utf8');
  const pages = fs.readFileSync(new URL('../pages/accounts.mjs', import.meta.url), 'utf8');
  assert.match(accounts, /登录正式版账号/);
  assert.match(accounts, /client:'bearer'/);
  assert.match(pages, /登录正式版账号/);
  assert.match(pages, /client:'bearer'/);
});
