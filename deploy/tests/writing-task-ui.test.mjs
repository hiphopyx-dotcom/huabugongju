import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {memberError} from '../../pages/model-privacy.mjs';
function setup({status=async()=>({online:true}),role='user'}={}){
 const handlers={},elements=new Map(),requests=[];
 const element=k=>{if(!elements.has(k))elements.set(k,{innerHTML:'',textContent:'',style:{display:'flex'},insertAdjacentHTML(){},scrollIntoView(){}});return elements.get(k)};
 const context=vm.createContext({memberError,document:{querySelector:element,addEventListener:(n,fn)=>handlers[n]=fn},URLSearchParams,location:{hash:''},clearTimeout(){},setTimeout:()=>1,crypto:{randomUUID:()=> 'request-1'},FormData:class{constructor(form){return Object.entries(form.values)}},fetch:async(url,options)=>{
  requests.push({url,...options});
  const data=url.includes('action=me')?{user:{id:'owner-1',name:'验收成员',role}}:url.includes('action=modules')?{modules:[]}:url.includes('action=status')?await status():url.includes('action=jobs')?{jobs:[]}:{job:{id:'job-1'}};
  return {ok:true,status:200,json:async()=>data};
 }});
 vm.runInContext(fs.readFileSync(new URL('../../pages/accounts.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')+'\nglobalThis.testAPI={init,textGeneration};',context);
 return {element,requests,open:options=>context.testAPI.textGeneration(options),init:()=>context.testAPI.init(()=>{}),submit:prompt=>handlers.submit({target:{dataset:{accountForm:'text-submit'},values:{prompt,grokAccountId:'untrusted-account'},querySelector:s=>s==='button'?{disabled:false}:null},preventDefault(){}})};
}
test('写作窗口立即反馈加载，完整预填并转义提示词，确认前不提交',async()=>{
 let finish;const pending=new Promise(r=>finish=r),s=setup({status:()=>pending});await s.init();
 const opening=s.open({title:'创建 AI 写作任务',prompt:'剧本资料</textarea><script>bad()</script>',context:'核对后提交'});
 assert.match(s.element('#modalBody').innerHTML,/正在读取语言模型/);
 finish({online:true});await opening;
 assert.match(s.element('#modalBody').innerHTML,/创建 AI 写作任务/);assert.match(s.element('#modalBody').innerHTML,/&lt;\/textarea&gt;&lt;script&gt;/);assert.doesNotMatch(s.element('#modalBody').innerHTML,/name="grokAccountId"|ChatGPT/);
 assert.equal(s.requests.filter(r=>r.url.includes('action=submit')).length,0);
 await s.submit('确认的写作要求');
 const body=JSON.parse(s.requests.find(r=>r.url.includes('action=submit')).body);assert.equal(body.prompt,'确认的写作要求');assert.equal(body.grokAccountId,undefined);
});
test('超长提示词完整保留，明确提示上限且拒绝提交，不静默截断',async()=>{
 const s=setup();await s.init();const prompt='原稿'.repeat(4100);await s.open({prompt});
 assert.ok(s.element('#modalBody').innerHTML.includes(prompt));assert.match(s.element('#modalBody').innerHTML,/超出上限/);
 await s.submit(prompt);assert.equal(s.requests.filter(r=>r.url.includes('action=submit')).length,0);assert.match(s.element('#accountError').textContent,/8000/);
});
test('状态读取失败显示可见错误，关闭等待窗口后不被异步结果重新打开',async()=>{
 const broken=setup({status:async()=>{throw Error('服务暂不可用')}});await broken.init();await broken.open();assert.match(broken.element('#accountError').textContent,/服务暂不可用/);
 let finish;const s=setup({status:()=>new Promise(r=>finish=r)});await s.init();const opening=s.open();s.element('#modal').style.display='none';finish({online:true});await opening;assert.equal(s.element('#modal').style.display,'none');assert.doesNotMatch(s.element('#modalBody').innerHTML,/data-account-form="text-submit"/);
});
