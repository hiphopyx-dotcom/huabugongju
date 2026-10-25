import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertWritingOwner} from '../../pages/language-writing.mjs';
import {adoptChatResult} from '../../pages/chatgpt-handoff.mjs';
test('写作候选不能跨账号、跨项目或覆盖已经编辑的原稿',()=>{
 const record={ownerId:'a',projectId:'80',kind:'next',scriptSnapshot:'第1集\n△人物走进房间，桌上放着一封信。\n'};
 assert.doesNotThrow(()=>assertWritingOwner(record,{id:'80'},{id:'a'}));
 assert.throws(()=>assertWritingOwner(record,{id:'40'},{id:'a'}),/项目或账号/);
 assert.throws(()=>assertWritingOwner(record,{id:'80'},{id:'b'}),/项目或账号/);
 const reply='第2集\n△人物拆开信封，看到一张自己从未拍过的照片。\n人物：这是谁拍的？';
 assert.match(adoptChatResult(record.scriptSnapshot,record,reply),/第2集/);
 assert.throws(()=>adoptChatResult(record.scriptSnapshot+'手工修改',record,reply),/原稿已经变化/);
});
