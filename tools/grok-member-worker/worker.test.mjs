import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyPageText, profileOwner, MemberStop, sniff} from './executor.mjs';
import {completionFor, processJob} from './worker.mjs';

test('page text maps to fixed reasons only', () => {
  assert.equal(classifyPageText('Please verify you are human'), 'CAPTCHA');
  assert.equal(classifyPageText('You have reached your daily limit. Upgrade to SuperGrok'), 'QUOTA');
  assert.equal(classifyPageText('This request was moderated'), 'CONTENT');
  assert.equal(classifyPageText('', 'https://accounts.x.ai/sign-in'), 'LOGIN');
  assert.equal(classifyPageText('图片 速度 质量 2.0'), null);
});
test('a live Chrome owning the profile is reported busy', async () => {
  assert.equal(await profileOwner('/p', {readlink: async () => 'Mac-mini.local-2418', alive: () => true}), 2418);
  assert.equal(await profileOwner('/p', {readlink: async () => 'Mac-mini.local-2418', alive: () => false}), null);
  assert.equal(await profileOwner('/p', {readlink: async () => {throw Error('ENOENT');}}), null);
});
test('definite stops release quota, unknown endings stay uncertain', () => {
  assert.deepEqual(completionFor(new MemberStop('CAPTCHA')), {error: 'REJECTED', reason: 'CAPTCHA'});
  assert.deepEqual(completionFor(new MemberStop('TIMEOUT', false)), {error: 'UNCERTAIN', reason: 'TIMEOUT'});
  assert.deepEqual(completionFor(new Error('boom')), {error: 'UNCERTAIN', reason: 'PAGE'});
});
test('a busy profile fails the job without opening the page', async () => {
  let imagined = false;
  const {result} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '1:1'}, {
    open: async () => {throw new MemberStop('BUSY');}, imagine: async () => {imagined = true;}, log: () => {},
  });
  assert.deepEqual(result, {error: 'REJECTED', reason: 'BUSY'}); assert.equal(imagined, false);
});
test('a finished page image is compressed and sent as a data URL', async () => {
  const jpeg = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
  const {result, stats} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '1:1'}, {
    open: async () => ({close: async () => {}}), imagine: async () => ({bytes: jpeg}), log: () => {},
    compress: async bytes => ({mime: 'image/jpeg', bytes, before: 7, after: 7, original: '/o.jpg'}),
  }).catch(e => ({result: {thrown: e.message}}));
  assert.ok(result.dataUrl?.startsWith('data:image/jpeg;base64,') || result.error, JSON.stringify(result));
  assert.equal(sniff(jpeg).mime, 'image/jpeg'); void stats;
});
