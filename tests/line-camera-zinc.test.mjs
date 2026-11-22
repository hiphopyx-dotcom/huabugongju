import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('仓库没有当前 grok.me 片场包，也不能把 MuseCanvas 插件写成 zinc 已支持', () => {
  const absent = ['index-C2J1yR0k.js', 'studio-B_cwBFps.js', 'studio-Bys5fsK4.js', '_episodeId-D8Lhqh2U.js'];
  for (const name of absent) {
    assert.equal(fs.existsSync(path.join(root, 'public', name)), false, name);
    assert.equal(fs.existsSync(path.join(root, 'integrations', name)), false, name);
  }
  const studio = read('public/studio/index.html');
  assert.match(studio, /src="app\.mjs"/);
  assert.doesNotMatch(studio, /index-C2J1yR0k/);
  assert.doesNotMatch(studio, /正在进入片场/);
  const note = read('docs/line-camera-zinc.md');
  assert.match(note, /01a1855e-24f5-77e3-9bc5-fda0059277d8/);
  assert.match(note, /882de73f5cfecb4c/);
  assert.match(note, /800453e5a3cb/);
  assert.match(note, /不算已支持/);
  assert.match(note, /mountLineCamera/);
  const plugin = read('integrations/musecanvas/plugins/jubaopeng-line-camera.js');
  assert.doesNotMatch(plugin, /zinc-raven|grok\.me|已支持 zinc/);
  const museDoc = read('docs/line-camera.md');
  assert.match(museDoc, /不能把这个插件说成 zinc 已支持/);
});
