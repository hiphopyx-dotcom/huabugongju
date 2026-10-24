import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {splitEpisodes,validateChatLink,buildHandoff,adoptChatResult} from '../../pages/chatgpt-handoff.mjs';
const script='第1集\n1-1 日 内 客厅\n人物：陆川、周宁\n△周宁递出账本。\n陆川：账本不能给别人。\n\n第2集\n2-1 夜 内 工厂\n人物：陆川、周宁\n△陆川锁上门。\n周宁：证据在我这里。\n';
const project={title:'桂花香起爱归来（80集独立版）',script,settings:{
  genre:'都市悬疑',words:'700–1000 字',writing:'保留前十集每集的强情绪追看钩子、场次和△动作格式。'}};
test('strictly recognizes numbered episode headings and preserves every original byte',()=>{
 const parts=splitEpisodes(script);
 assert.equal(parts.length,2);
 assert.deepEqual(parts.map(p=>p.label),['第1集','第2集']);
 assert.equal(parts.map(p=>p.text).join(''),script);
 assert.equal(parts[0].key,'第1集#1');
 assert.equal(splitEpisodes('第一集\n△动作\n第二集\n△动作').length,2);
 assert.equal(splitEpisodes('没有集标题').length,1);
});
test('handoff pack targets one episode and includes user writing rules rather than making an API call',()=>{
 const pack=buildHandoff(project,{kind:'rewrite',scope:'episode',partKey:'第2集#1',
  requirement:'只修改第二集台词；不碰第一集'});
 assert.equal(pack.sourceKey,'第2集#1');
 assert.equal(pack.source,splitEpisodes(script)[1].text);
 assert.match(pack.prompt,/桂花香起爱归来/);
 assert.match(pack.prompt,/80集独立版/);
 assert.match(pack.prompt,/只修改第二集台词/);
 assert.match(pack.prompt,/同场连续△动作合并/);
 assert.ok(!pack.source.includes('账本不能给别人'));
 assert.ok(!pack.prompt.includes('OPENAI_API_KEY'));
});
test('next-episode handoff includes adjacent context and avoids irrelevant future episodes',()=>{
 const pack=buildHandoff(project,{kind:'next',scope:'episode',partKey:'第1集#1'});
 assert.match(pack.source,/账本不能给别人/);
 assert.ok(!pack.source.includes('证据在我这里'));
 assert.match(pack.prompt,/紧随“第1集”之后的下一集/);
});
test('large full drafts are rejected rather than silently truncated',()=>{
 const long={...project,script:'第1集\n'+'内容A'.repeat(25000)};
 assert.throws(()=>buildHandoff(long,{kind:'rewrite',scope:'full'}),/超过本次安全交接上限/);
 assert.throws(()=>buildHandoff(long,{kind:'review',scope:'episode',partKey:'第1集#1'}),/超过本次安全交接上限/);
});
test('resume into a specific ChatGPT chat allows only safe first-party URLs',()=>{
 assert.equal(validateChatLink(''),'https://chatgpt.com/');
 assert.equal(validateChatLink('https://chatgpt.com/'),'https://chatgpt.com/');
 assert.equal(validateChatLink('https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
 for(const bad of ['javascript:alert(1)','https://evil.example/c/thread123456789',
   'https://chatgpt.com.evil.example/c/thread123456','http://chatgpt.com/',
   'https://chatgpt.com/?prompt=secret',
   'https://chatgpt.com/c/thread?evil=1']){
   assert.throws(()=>validateChatLink(bad),/只允许/);
 }
});
test('only explicitly selected episode can be rewritten while neighboring episodes remain byte-equal',()=>{
 const pack=buildHandoff(project,{kind:'rewrite',scope:'episode',partKey:'第2集#1'});
 const result=adoptChatResult(script,{...pack,selectedSnapshot:splitEpisodes(script)[1].text},
   '第2集\n2-1 夜 内 工厂\n人物：陆川、周宁\n△陆川锁上门，压住钥匙。\n周宁：我把证据放在你桌上了。\n');
 assert.ok(result.startsWith(splitEpisodes(script)[0].text.replace(/\n*$/,'')));
 assert.match(result,/压住钥匙/);
 assert.equal(splitEpisodes(result)[0].text.trim(),splitEpisodes(script)[0].text.trim());
 assert.throws(()=>adoptChatResult(script+'被编辑过',{...pack,selectedSnapshot:splitEpisodes(script)[1].text},'第2集\n人物：周宁\n△对话内容很长，已经修改完成并保持本集。'),/原稿已经变化/);
 assert.throws(()=>adoptChatResult(script,{...pack,selectedSnapshot:splitEpisodes(script)[1].text},'第1集\n1-1 日 内 客厅\n△擅自改为第一集，不允许错误覆盖任何已有分集。'),/原有集标题/);
});
test('next episode append is guarded against duplicate headings and incomplete output',()=>{
 const pack=buildHandoff(project,{kind:'next',scope:'episode',partKey:'第2集#1'});
 const next='第3集\n3-1 夜 内 楼梯间\n人物：周宁\n△周宁扶住扶手，拿出录音笔。\n周宁：这次谁也别想逃。\n';
 const result=adoptChatResult(script,pack,next);
 assert.match(result,/第3集/);assert.equal(splitEpisodes(result).length,3);
 assert.throws(()=>adoptChatResult(script,pack,'第2集\n△重复第二集标题，不可以将其当作新剧本加入系统。'),/已存在/);
 assert.throws(()=>adoptChatResult(script,pack,'未以集标题开头\n'+'描述'.repeat(20)),/必须以/);
});
test('reviews/outlines cannot overwrite canon and incomplete full rewrites are blocked',()=>{
 for(const kind of ['review','outline']){
   const p=buildHandoff(project,{kind,scope:'full'});
   assert.throws(()=>adoptChatResult(script,p,'第1集\n'+'错误处理'.repeat(15)),/参考材料/);
 }
 const p=buildHandoff(project,{kind:'rewrite',scope:'full'});
 assert.throws(()=>adoptChatResult(script,p,'第1集\n'+'对白'.repeat(11)),/短超过/);
});
test('no hidden API credentials, DOM scraping or automated message submission are present',()=>{
 const source=fs.readFileSync(new URL('../../pages/chatgpt-handoff.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('https://chatgpt.com/'));
 assert.ok(source.includes('clipboardWrite('));
 assert.ok(source.includes('window.open('));
 for(const marker of ['api.openai.com','OPENAI_API_KEY','GEMINI_API_KEY','document.cookie','postMessage(','window.fetch('])
  assert.ok(!source.includes(marker),'Unexpected '+marker);
});
