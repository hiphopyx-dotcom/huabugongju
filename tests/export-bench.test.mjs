import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bench export parses, resolves imports, and stamps the commit', () => {
  const git = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: root, encoding: 'utf8'});
  assert.equal(git.status, 0, git.stderr);
  const version = git.stdout.trim();
  const run = spawnSync(process.execPath, ['scripts/export-bench.mjs'], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const index = fs.readFileSync(path.join(root, 'bench-export/index.html'), 'utf8');
  assert.match(index, new RegExp(`src="app\\.mjs\\?v=${version}"`));
  assert.equal(index.includes('g11pack') || index.includes('g11bridge') || index.includes('g10fold'), false);
  const workbench = fs.readFileSync(path.join(root, 'bench-export/image-workbench.mjs'), 'utf8');
  assert.match(workbench, /planImageBatch/);
  assert.match(workbench, new RegExp(`from '\\./image-workflow\\.mjs\\?v=${version}'`));
  const workflow = fs.readFileSync(path.join(root, 'bench-export/image-workflow.mjs'), 'utf8');
  assert.match(workflow, /export function planImageBatch/);
  assert.match(run.stdout, new RegExp(`\\?v=${version}`));
});
