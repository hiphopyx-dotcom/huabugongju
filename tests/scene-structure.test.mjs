import test from 'node:test';
import assert from 'node:assert/strict';
import {locationViewPrompt} from '../public/studio/location-views.mjs';
import {coverageSlot, oppositeViewKind} from '../public/studio/ots-coverage.mjs';
import {panoYaw} from '../public/studio/pano-viewer.mjs';
import {buildImageWorkshopPrompt} from '../public/studio/image-workshop-core.mjs';
import {ensureDesk, prepareStill} from '../public/studio/pianchang-core.mjs';
import {project} from '../public/studio/core.mjs';

test('结构 A 的俯视是写实鸟瞰，结构 B 的俯视仍是白模', () => {
  const photo = locationViewPrompt({heading:'内景 门房', name:'门房'}, 'a_plan');
  assert.match(photo, /Photoreal/);
  assert.match(photo, /NOT a white clay model/);
  const clay = buildImageWorkshopPrompt('locations', {kind:'plan', name:'门房', heading:'内景 门房'});
  assert.match(clay.prompt, /正交垂直俯视白模/);
  assert.doesNotMatch(clay.prompt, /NOT a white clay model/);
});

test('反打用同一场景的对面机位，正打可以吃全景', () => {
  assert.equal(oppositeViewKind('view_n'), 'view_s');
  assert.equal(oppositeViewKind('view_w'), 'view_e');
  assert.equal(coverageSlot('reverse', 'view_n', true), 'view_s');
  assert.equal(coverageSlot('frame', 'view_n', true), 'pano');
  const p = project('夜渡');
  p.script = '第一集\n1-1 夜 内 门房\n△对视。';
  const desk = ensureDesk(p, () => 'id');
  desk.locations.push({id:'room', name:'门房', episode:'第一集', scope:'episode', heading:'内景 门房'});
  desk.beats = [{id:'shot', episode:'第一集', scene_heading:'1-1', action:'对视', composition:'过肩镜头', ots_from:'a', ots_to:'b', locationNames:['门房'], characterNames:[]}];
  desk.characters.push({id:'a', name:'甲', episode:'第一集', scope:'episode'}, {id:'b', name:'乙', episode:'第一集', scope:'episode'});
  for (const slot of ['front']) for (const id of ['a','b']) { desk.images[id+':'+slot] = {id:id+'-face'}; desk.stills[id+':'+slot] = '/api/images?action=content&id='+id+'-face'; }
  desk.images['room:view_n'] = {id:'north'}; desk.stills['room:view_n'] = '/api/images?action=content&id=north';
  desk.images['room:view_s'] = {id:'south'}; desk.stills['room:view_s'] = '/api/images?action=content&id=south';
  p.shots = [{id:'shot', episode:'第一集', scene:'1-1', description:'对视', dialogue:'', duration:4, angle:'过肩镜头', otsFrom:'ref-a', otsTo:'ref-b', locationNames:['门房'], characterNames:['甲','乙'], size:'中景', framing:'三分构图', camera:'固定镜头', stylize:'电影叙事', lighting:'自然光'}];
  const reverse = prepareStill(p, desk, 'storyboard', 'shot', 'reverse');
  assert.ok(reverse.references.some(ref => ref.id === 'south'));
});

test('全景拖动按画布宽度换算朝向', () => {
  assert.equal(panoYaw(0, 320, 640), 180);
  assert.equal(panoYaw(350, 40, 640), 12.5);
});
