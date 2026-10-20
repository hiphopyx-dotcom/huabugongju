import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scriptParts,sealedPartsIntact} from '../../pages/script-review.mjs';

const sample='第1集\n1-1 客厅 日 内\n△陆川拿起账本。\n陆川：账有问题。\n第1集完\n\n第2集\n2-1 公司 夜 内\n△周宁拦住陆川。\n周宁：请跟我来。\n第2集完';
test('splits independent numbered episodes without including end markers as new episodes',()=>{
 const parts=scriptParts(sample);
 assert.equal(parts.length,2);
 assert.equal(parts[0].key,'第1集#1');
 assert.equal(parts[1].key,'第2集#1');
 assert.equal(parts.map(p=>p.text).join(''),sample);
});
test('preserves unnumbered scripts as full text',()=>{
 assert.deepEqual(scriptParts('陆川：你好。').map(p=>p.key),['全文']);
});
test('a sealed episode forbids edits to itself but permits another episode',()=>{
 const [first,second]=scriptParts(sample);
 const locked={script:sample,scriptSeals:{[first.key]:{text:first.text,at:1}}};
 assert.equal(sealedPartsIntact(locked,sample),true);
 assert.equal(sealedPartsIntact(locked,sample.replace('请跟我来','先别走')),true);
 assert.equal(sealedPartsIntact(locked,sample.replace('账有问题','账没问题')),false);
 assert.equal(sealedPartsIntact(locked,second.text),false);
});
test('seal protection preserves a separate sealed episode on insert or rename',()=>{
 const parts=scriptParts(sample);
 const locked={script:sample,scriptSeals:{[parts[1].key]:{text:parts[1].text,at:1}}};
 assert.equal(sealedPartsIntact(locked,sample.replace('第1集完','第1集完\n
人物小传')),true);
 assert.equal(sealedPartsIntact(locked,sample.replace('第2集\n','第二回\n')),false);
});
