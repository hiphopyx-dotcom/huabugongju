import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auditScript,meetsAcceptance} from '../../pages/script-quality.mjs';

test('flags continuous △ lines and movement in dialogue emotion bracket',()=>{
 const text=['第1集','1-1 车间 日 内','人物：陆川 周宁','△陆川端起茶杯。','','△周宁放下账本。','周宁（低头抿嘴）：算你想得周全。','周宁（低声）：是这样。'].join('\n');
 const result=auditScript(text);
 assert.equal(result.red,2);
 assert.equal(result.issues[0].line,6);
 assert.equal(result.issues[1].line,7);
});
test('dialogue and scene boundaries reset continuous action grouping',()=>{
 const result=auditScript(['△陆川放下杯子。','周宁：别走。','△周宁站起来。','1-2 门口 夜 外','△周宁拦住陆川。'].join('\n'));
 assert.equal(result.red,0);
});
test('does not award an AI score from local lint findings',()=>{
 const report=auditScript('周宁（低声）：你好。');
 assert.equal(meetsAcceptance(null,report),false);
 assert.equal(meetsAcceptance({score:95,hardFailures:[]},report),true);
 assert.equal(meetsAcceptance({score:96,hardFailures:['主线冲突']},report),false);
 assert.equal(meetsAcceptance({score:94,hardFailures:[]},report),false);
 assert.equal(meetsAcceptance({score:99,hardFailures:[]},auditScript('△A\n△B')),false);
});
