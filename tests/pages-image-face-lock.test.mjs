// The /bench export serves pages/, not public/studio. These checks lock the
// face-lock repair to that copy: batch planning stays exported, prompts keep
// real newlines, and a locked face replaces the front identity reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planImageBatch, imageSlotReferences, buildWorkflowPrompt} from '../pages/image-workflow.mjs';

const source = readFileSync(new URL('../pages/image-workflow.mjs', import.meta.url), 'utf8');
const entity = (extra={}) => ({id:'c',category:'characters',name:'阿青',scope:'episode',episode:'第一集',projectId:'p1',fields:{},...extra});
const item = (id,slot,extra={}) => ({id,projectId:'p1',created:1,metadata:{entityId:'c',slot,episode:'第一集'},...extra});

test('pages workflow source keeps separators, newlines, and asset entity names',()=>{
 assert.ok(source.includes("join('\\u0000')"));
 assert.equal(source.includes("join('\\\\u0000')"), false);
 assert.ok(source.includes("join('\\n')"));
 assert.equal(source.includes("join('\\\\n')"), false);
 assert.ok(source.includes("result.prompt+='\\n完整分镜参数与原文：\\n'"));
 assert.equal(source.includes("result.prompt+='\\\\n完整分镜参数与原文：\\\\n'"), false);
 assert.ok(source.includes('text(meta.entityName)||asset.name'));
 assert.equal(source.includes('text(meta.name)||asset.name'), false);
 assert.ok(source.includes('export function planImageBatch'));
});

test('pages batch planning still fills only empty character slots',()=>{
 const jobs=planImageBatch({category:'characters',entities:[entity()],items:[item('front','front')],projectId:'p1'});
 assert.equal(jobs.length,10);
 assert.equal(jobs.some(job=>job.slot==='front'), false);
 assert.deepEqual(jobs[0],{entityId:'c',slot:'side'});
});

test('a locked face replaces the front reference and falls back when that image is unusable',()=>{
 const locked=entity({faceLockId:'locked-face'});
 const items=[item('front-new','front',{created:20}),item('locked-face','side',{created:5})];
 assert.deepEqual(imageSlotReferences(locked,'side',items),[{id:'locked-face'}]);
 assert.deepEqual(imageSlotReferences(locked,'front',items),[{id:'locked-face'}]);
 assert.deepEqual(imageSlotReferences(entity({faceLockId:'missing'}),'side',items),[{id:'front-new'}]);
 assert.deepEqual(imageSlotReferences(entity({faceLockId:'missing'}),'front',items),[]);
 assert.deepEqual(imageSlotReferences(entity(),'side',items),[{id:'front-new'}]);
 const gone=item('gone','front',{created:99,deletedAt:1});
 assert.deepEqual(imageSlotReferences(entity({faceLockId:'gone'}),'expr_smile',[...items,gone]),[{id:'front-new'}]);
 const running=item('running','front',{status:'running'});
 assert.deepEqual(imageSlotReferences(entity({faceLockId:'running'}),'side',[...items,running]),[{id:'front-new'}]);
});

test('character extra lines stay on separate prompt lines',()=>{
 const result=buildWorkflowPrompt({id:'p1',settings:{},shots:[],assets:[],imageWorkspace:{}},entity({fields:{extraPrompt:'第一行'}}),'front',{extraPrompt:'第二行'});
 assert.ok(result.prompt.includes('第一行\n第二行'));
 assert.equal(result.prompt.includes('\\n'), false);
});
