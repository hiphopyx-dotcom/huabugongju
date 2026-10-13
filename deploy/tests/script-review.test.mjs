import test from 'node:test';
import assert from 'node:assert/strict';
import {isLockedEpisode,countScriptChars,evaluateReview,parseReview,createScriptReviewHandler} from '../lib/script-review.mjs';

test('封板范围与独立集号正确识别',()=>{
 assert.equal(isLockedEpisode(8,'1-10,30,50'),true);
 assert.equal(isLockedEpisode(11,'1-10,30,50'),false);
 assert.equal(isLockedEpisode(30,'1-10,30,50'),true);
 assert.equal(isLockedEpisode(42,'40至45'),true);
});
test('结构化评审采用客观字数和严重问题硬门槛',()=>{
 const script='△'+('剧情冲突真实推进。'.repeat(30));
 assert.ok(countScriptChars(script)>=100);
 const high=evaluateReview({score:99,issues:[],summary:'可拍'},script,95,100,1000);
 assert.equal(high.passed,true);
 const issue=evaluateReview({score:99,issues:[{severity:'critical',problem:'因果冲突'}]},script,95,100,1000);
 assert.equal(issue.passed,false);
 const short=evaluateReview({score:99},'两句台词',95,100,1000);
 assert.equal(short.passed,false);
});
test('Gemini JSON 和 JSON 代码围栏能够解析',()=>{
 assert.equal(parseReview('{"score":95}').score,95);
 const fence=String.fromCharCode(96).repeat(3);
 assert.equal(parseReview(fence+'json\n{"score":95}\n'+fence).score,95);
 assert.throws(()=>parseReview('无效结果'),/JSON/);
});
const query=async sql=>sql.includes('studio_login_limits')?[{attempts:1}]:[{id:'admin-id',role:'admin'}];
const config={openaiKey:'fake-openai',geminiKey:'fake-gemini',openaiModel:'test-gpt',geminiModel:'test-gemini'};
const request=(stage,payload={})=>new Request('https://localhost.test/api/script-review',{method:'POST',headers:{'Origin':'https://localhost.test','Cookie':'__Host-jbp-session=unit-test','Content-Type':'application/json'},body:JSON.stringify({stage,episodeNo:11,minChars:100,maxChars:1000,threshold:95,...payload})});
test('服务端拒绝封板集并且不会调用供应商',async()=>{
 let calls=0;
 const h=createScriptReviewHandler(query,config,()=>{calls++;throw Error('should not call')});
 const res=await h(request('draft',{episodeNo:3,lockedEpisodes:'1-10'}));
 assert.equal(res.status,409);assert.equal(calls,0);
});
test('未登录请求禁止调用 OpenAI',async()=>{
 let calls=0;
 const h=createScriptReviewHandler(async()=>[],config,()=>{calls++;throw Error('should not call')});
 const res=await h(request('draft'));
 assert.equal(res.status,401);assert.equal(calls,0);
});
test('OpenAI 写作以单集为单位且不传出密钥到响应',async()=>{
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal(options.headers.Authorization,'Bearer fake-openai');
  assert.equal(JSON.parse(options.body).store,false);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'第11集\n1-1 夜 内 客厅\n△危机升级。\n女主：我不退！'}]}]});
 };
 const h=createScriptReviewHandler(query,config,fetcher);
 const res=await h(request('draft'));
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.stage,'draft');
 assert.match(body.text,/第11集/);
 assert.ok(!JSON.stringify(body).includes('fake-openai'));
});
test('Gemini 独立评分返回结构化问题和通过状态',async()=>{
 const fetcher=async(url,options)=>{
  assert.match(url,/generativelanguage\.googleapis\.com/);
  assert.equal(options.headers['x-goog-api-key'],'fake-gemini');
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({score:98,summary:'完整',issues:[]})}]}}]});
 };
 const h=createScriptReviewHandler(query,config,fetcher);
 const res=await h(request('review',{text:'△情节推进，因果明确，角色行为一致。'.repeat(12)}));
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.review.passed,true);
 assert.equal(body.review.score,98);
});
