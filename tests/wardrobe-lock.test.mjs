import test from 'node:test';
import assert from 'node:assert/strict';
import {isCharacterFollowKind, wardrobeLockPrompt} from '../public/studio/wardrobe-lock.mjs';
import {buildImageWorkshopPrompt} from '../public/studio/image-workshop-core.mjs';
import {ensureDesk, prepareStill} from '../public/studio/pianchang-core.mjs';
import {project} from '../public/studio/core.mjs';

test('侧面、背面、表情才跟正面母版', () => {
  assert.equal(isCharacterFollowKind('front'), false);
  assert.equal(isCharacterFollowKind('side'), true);
  assert.equal(isCharacterFollowKind('back'), true);
  assert.equal(isCharacterFollowKind('expr_smile'), true);
});

test('正面是服装母版，侧面锁 IMAGE_0', () => {
  const front = wardrobeLockPrompt({kind:'front', costume:'黑色皮夹克', hasFrontRef:false});
  assert.match(front, /MASTER wardrobe plate/);
  assert.match(front, /黑色皮夹克/);
  assert.doesNotMatch(front, /WARDROBE LOCK/);
  const side = wardrobeLockPrompt({kind:'side', costume:'白衬衫', hasFrontRef:true});
  const back = wardrobeLockPrompt({kind:'back', costume:'白衬衫', hasFrontRef:true});
  for (const text of [side, back]) {
    assert.match(text, /WARDROBE LOCK/);
    assert.match(text, /IMAGE_0 is this character's FRONT plate/);
    assert.match(text, /Costume bible/);
    assert.match(text, /Do not add a new coat/);
    assert.match(text, /Outfit is frozen/);
  }
  assert.match(side, /90 degrees/);
  assert.match(back, /180 degrees/);
});

test('出图提示词在有正面参考时带上服装锁，分镜带场景冻结', () => {
  const side = buildImageWorkshopPrompt('characters', {kind:'side', name:'凯恩', costume:'黑色皮夹克', referenceCount:1, appearance:'短发'});
  assert.match(side.prompt, /WARDROBE LOCK/);
  assert.match(side.prompt, /Costume bible/);
  assert.match(side.prompt, /Do not add a new coat/);
  assert.match(side.prompt, /Single character turnaround still/);
  const frame = buildImageWorkshopPrompt('storyboard', {kind:'frame', name:'门房', action:'推门', referenceCount:1});
  assert.match(frame.prompt, /SCENE IS FROZEN/);
  assert.match(frame.prompt, /360 panorama/);
});

test('正面图排在 IMAGE_0，质感词会进重出提示词', () => {
  const p = project('夜渡');
  p.script = '第一集\n1-1 日 内 门房\n人物：凯恩';
  const desk = ensureDesk(p, () => 'id');
  desk.episode = '第一集';
  desk.characters.push({id:'kane', name:'凯恩', scope:'episode', episode:'第一集', role:'军官', age:'30', gender:'男', appearance:'短发', costume:'黑色皮夹克'});
  desk.images['kane:front'] = {id:'front-plate'};
  desk.stills['kane:front'] = '/api/images?action=content&id=front-plate';
  desk.grades.kane = {light:'fill', skin:'natural', grain:'film'};
  const still = prepareStill(p, desk, 'characters', 'kane', 'side');
  assert.equal(still.references[0].id, 'front-plate');
  assert.match(still.prompt, /WARDROBE LOCK/);
  assert.match(still.prompt, /soft fill/);
  assert.match(still.prompt, /natural living skin/);
  assert.match(still.prompt, /film grain/);
});
