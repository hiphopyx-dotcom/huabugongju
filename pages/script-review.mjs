import * as DB from './db.mjs';
const $=id=>document.getElementById(id),E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT_RUBRIC='每集700—1000字（第1集1000—1500字）；剧情衔接自然，人物动机与语言一致；冲突密集、反转有因果，前三秒有吸引力；每集末尾有强钩子；同一连续动作合并△，字幕/时间提示使用独立△字幕：；不擅改已锁母版；每一集有真实推进，不重复凑数；每10集形成阶段闭环，主要卡点按项目约定标注。';
let user=null,projects=[],current=null,baseline='',archive=null,archiveDB=null,busy=false,cancelled=false,aborter=null,configured=null;
const currentNumber=()=>Math.max(1,Math.min(200,Number($('episodeNo').value)||1));
const log=message=>{$('status').textContent=message};
const countChars=text=>(String(text).match(/[\p{L}\p{N}]/gu)||[]).length;
function namedNumber(s){
 if(/^\d+$/.test(s))return Number(s);
 const n={'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100,'千':1000};
 let total=0,part=0;
 for(const c of s){const v=n[c];if(v===undefined)return NaN;if(v>=10){total+=(part||1)*v;part=0}else part=v}
 return total+part;
}
export function spans(script){
 const regex=/^第\s*([零一二三四五六七八九十百千\d]+)\s*集[^\n]*/gm,items=[];let m;
 while((m=regex.exec(script)))items.push({no:namedNumber(m[1]),at:m.index,header:m[0]});
 return items.map((v,i)=>({...v,end:i+1<items.length?items[i+1].at:script.length}));
}
function extractEpisode(script,no){
 const items=spans(script),item=items.find(x=>x.no===no);
 if(item)return script.slice(item.at,item.end).trim();
 if(!items.length&&no===1)return script.trim();
 return '';
}
export function replaceEpisode(script,no,text){
 const items=spans(script),target=items.find(x=>x.no===no);
 if(target)return script.slice(0,target.at)+text.trim()+'\n\n'+script.slice(target.end);
 if(!script.trim())return text.trim()+'\n';
 if(items.length&&no>Math.max(...items.map(x=>x.no)))return script.trim()+'\n\n'+text.trim()+'\n';
 throw Error('无法安全定位这一集：当前项目没有可识别的分集标题，请先整理“第N集”标题或复制终稿手动合并');
}
function idbOpen(scope){return new Promise((resolve,reject)=>{const request=indexedDB.open('jbp-script-review-'+scope,1);request.onupgradeneeded=()=>request.result.createObjectStore('archives',{keyPath:'projectId'});request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)})}
function archiveRequest(mode,fn){return new Promise((resolve,reject)=>{const tx=archiveDB.transaction('archives',mode);const request=fn(tx.objectStore('archives'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error)})}
const archiveGet=id=>archiveRequest('readonly',s=>s.get(id));
const archivePut=entry=>archiveRequest('readwrite',s=>s.put(structuredClone(entry)));
const recordFor=no=>archive.history[String(no)]||(archive.history[String(no)]=[]);
function settingsFromUI(){return {context:$('context').value,rubric:$('rubric').value,lockedEpisodes:$('lockedEpisodes').value,threshold:Number($('threshold').value),maxRounds:Number($('maxRounds').value),minChars:Number($('minChars').value),maxChars:Number($('maxChars').value)}}
async function persist(){archive.settings=settingsFromUI();archive.updated=Date.now();await archivePut(archive)}
function updateCount(){$('charCount').textContent=countChars($('source').value)+' 计数字符'}
async function stage(stageName,payload){
 aborter=new AbortController();
 const response=await fetch('/api/script-review',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:stageName,title:current.title,episodeNo:currentNumber(),...settingsFromUI(),...payload}),signal:aborter.signal});
 const body=await response.json().catch(()=>({error:'服务响应格式异常'}));
 if(!response.ok)throw Error(body.error||'模型请求失败（HTTP '+response.status+'）');
 return body;
}
async function append(step,extra){recordFor(currentNumber()).push({id:crypto.randomUUID(),step,created:Date.now(),...extra});await persist();renderHistory()}
function latestText(no=currentNumber()){
 const arr=recordFor(no);
 return [...arr].reverse().find(v=>v.text)?.text||'';
}
function latestReview(no=currentNumber()){
 const arr=recordFor(no);
 return [...arr].reverse().find(v=>v.review)?.review||null;
}
function renderHistory(){
 const history=recordFor(currentNumber()),latest=latestReview();
 $('history').innerHTML=history.length?history.slice().reverse().map((h,i)=>'<details class="review-step"><summary>'+E(new Date(h.created).toLocaleString('zh-CN'))+' · '+E(({draft:'OpenAI 初稿',revision:'OpenAI 修订',review:'Gemini 评审',manual:'人工草稿',adopt:'人工采纳'}[h.step]||h.step))+(h.review?' · '+E(h.review.score)+' 分'+(h.review.passed?'（验收通过）':'（待修改）'):'')+'</summary>'+(h.text?'<pre>'+E(h.text)+'</pre>':'')+(h.review?'<pre>'+E(JSON.stringify(h.review,null,2))+'</pre>':'')+'</details>').join(''):'<div class="muted">尚无历史版本。</div>';
 $('reviewIssues').innerHTML=latest?'<h2>'+E(latest.score)+' / 100</h2><p class="'+(latest.passed?'review-passed':'review-warning')+'">'+(latest.passed?'验收通过，可人工采纳':'尚未通过验收')+'</p><p>'+E(latest.summary)+'</p><p>'+E(latest.charCount)+' 计数字符</p>'+(latest.reasons.length?'<p class="review-warning">'+E(latest.reasons.join('；'))+'</p>':'')+(latest.issues.map(x=>'<div class="review-step"><b>'+E(x.severity)+'</b> '+E(x.location)+'<br>'+E(x.problem)+'<br><span class="muted">建议：'+E(x.suggestion)+'</span></div>').join('')||'<p class="muted">Gemini 未报告需要处理的问题。</p>'):'<p class="muted">先完成 Gemini 评审，才会出现结构化报告。</p>';
}
function locked(){
 const no=currentNumber(),s=$('lockedEpisodes').value;
 return s.split(/[,，、;\s]+/).some(part=>{const m=part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);return m?no>=+m[1]&&no<=+m[2]:/^\d+$/.test(part)&&no===+part});
}
function showEpisode(){
 const no=currentNumber();$('firstEpisode').value=no===1?'是（首集标准）':'否（常规标准）';
 const settings=archive.settings||{};
 $('minChars').value=no===1?1000:700;$('maxChars').value=no===1?1500:1000;
 if(settings.customLimits?.[no]){[$('minChars').value,$('maxChars').value]=settings.customLimits[no]}
 $('source').value=latestText(no)||extractEpisode(current.script||'',no);
 updateCount();renderHistory();log('第'+no+'集已载入；原项目未修改。');
}
async function selectProject(id){
 if(busy)return;
 current=projects.find(x=>x.id===id);
 if(!current)return;
 baseline=current.script||'';
 archive=await archiveGet(id)||{projectId:id,history:{},settings:{rubric:DEFAULT_RUBRIC,lockedEpisodes:'',threshold:95,maxRounds:3,context:'',minChars:700,maxChars:1000,customLimits:{}}};
 const s=archive.settings;
 $('rubric').value=s.rubric||DEFAULT_RUBRIC;$('lockedEpisodes').value=s.lockedEpisodes||'';$('threshold').value=s.threshold||95;$('maxRounds').value=s.maxRounds??3;$('context').value=s.context||'';
 showEpisode();
}
async function run(){
 if(busy||!current)return;
 if(locked())return log('该集已封板，禁止启动自动评审。');
 if(!configured.openaiConfigured||!configured.geminiConfigured)return log('请先在 Vercel 项目配置 OPENAI_API_KEY 与 GEMINI_API_KEY，才能使用自动模式。');
 const s=settingsFromUI();
 if(!Number.isInteger(s.threshold)||s.threshold<60||s.threshold>100||!Number.isInteger(s.maxRounds)||s.maxRounds<0||s.maxRounds>3||!Number.isInteger(s.minChars)||s.minChars<100||!Number.isInteger(s.maxChars)||s.maxChars<s.minChars)return log('验收参数无效，请检查分数、轮次和字数。');
 busy=true;cancelled=false;$('run').disabled=true;const episode=currentNumber();
 try{
  let text=$('source').value.trim();
  if(!text){
   log('第'+episode+'集：OpenAI 正在创作初稿…');
   const draft=await stage('draft',{text:''});text=draft.text;
   await append('draft',{model:draft.model,text});
   $('source').value=text;updateCount();
  }else{
   await append('manual',{text});
  }
  for(let round=0;round<=s.maxRounds;round++){
   if(cancelled)break;
   log('第'+episode+'集：Gemini 第'+(round+1)+'次独立评审…');
   const result=await stage('review',{text});
   await append('review',{model:result.model,review:result.review});
   if(result.review.passed){log('第'+episode+'集通过验收（'+result.review.score+'分），已保存版本；等待人工采纳终稿。');break}
   if(round===s.maxRounds){log('已达最大修订轮次，仍未通过；请人工审阅问题。');break}
   if(cancelled)break;
   log('第'+episode+'集：OpenAI 正在按 Gemini 意见进行第'+(round+1)+'轮修订…');
   const revised=await stage('revise',{text,feedback:result.review});
   text=revised.text;
   $('source').value=text;updateCount();
   await append('revision',{model:revised.model,text,round:round+1});
  }
 }catch(e){log((e.name==='AbortError'?'已中止当前请求。':'流程中断：'+e.message)+' 已完成的版本仍保留。')}
 finally{aborter=null;busy=false;$('run').disabled=false;renderHistory()}
}
async function adopt(){
 if(busy||!current)return;
 if(locked())return log('封板集禁止写回。');
 const history=recordFor(currentNumber()),last=history.at(-1);
 if(last?.step!=='review'||!last.review?.passed)return log('只能采纳最新一轮 Gemini 验收通过的剧本；人工改动后须重新送审。');
 const text=latestText();
 if(!text)return log('没有可采纳的正文。');
 const fresh=await DB.get(current.id);
 if(!fresh||fresh.script!==baseline)return log('项目正文已在其他窗口改变。为避免覆盖，请先返回工作台核对后重新载入。');
 let merged;
 try{merged=replaceEpisode(fresh.script||'',currentNumber(),text)}catch(e){return log(e.message)}
 if(!confirm('确认将第'+currentNumber()+'集的验收稿写回项目？此前项目全文已核对；审稿历史仍会保留。'))return;
 fresh.script=merged;fresh.updated=Date.now();await DB.put(fresh);
 current=fresh;baseline=merged;await append('adopt',{text,reviewScore:last.review.score});
 log('终稿已采纳并保存到本地项目。建议立即返回工作台导出项目备份。');
}
function download(name,content,type='application/json'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function exportWord(){
 if(!current)return;
 const fresh=await DB.get(current.id),body={title:fresh.title,context:$('context').value,script:fresh.script||''};
 if(!body.script.trim())return log('项目内暂无完整剧本；请先采纳终稿后导出 Word。');
 try{
  const res=await fetch('/api/script-export',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const b=await res.json().catch(()=>({}));throw Error(b.error||'Word 导出失败')}
  download(fresh.title.replace(/[\/\\?%*:|"<>\u0000-\u001f]/g,'_')+'.docx',await res.blob(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  log('已导出项目正文 Word；内容以当前项目已采纳的版本为准。');
 }catch(e){log(e.message)}
}
async function boot(){
 try{
  const me=await fetch('/api/accounts?action=me',{credentials:'same-origin'}).then(r=>r.json());
  if(!me.user||me.user.role!=='admin')throw Error('请先在工作台登录管理员账户，双模型 API 暂仅对管理员开放。');
  user=me.user;$('identity').textContent='管理员：'+user.name;
  await DB.setScope(user.id);archiveDB=await idbOpen(user.id);
  projects=await DB.list();if(!projects.length)throw Error('没有本地项目，请先在剧爆棚工作台创建剧本项目。');
  $('project').innerHTML=projects.map(p=>'<option value="'+E(p.id)+'">'+E(p.title)+'</option>').join('');
  const active=localStorage.getItem('jbp-active');
  if(projects.some(p=>p.id===active))$('project').value=active;
  configured=await fetch('/api/script-review',{credentials:'same-origin'}).then(r=>r.json());
  await selectProject($('project').value);
  if(!configured.openaiConfigured||!configured.geminiConfigured)log('已载入项目。请先配置两家 API Key（仅在服务器设置，网页不要求输入密钥）。');
 }catch(e){log('不可用：'+e.message);$('run').disabled=true}
}
$('project').addEventListener('change',e=>selectProject(e.target.value));
$('episodeNo').addEventListener('change',showEpisode);
$('source').addEventListener('input',updateCount);
$('run').addEventListener('click',run);
$('stop').addEventListener('click',()=>{cancelled=true;aborter?.abort();log('已请求停止，不再启动下一轮。当前供应商请求可能仍计费。')});
$('saveDraft').addEventListener('click',async()=>{if(busy)return;await append('manual',{text:$('source').value});log('人工草稿已保留在独立版本库。')});
$('adopt').addEventListener('click',adopt);
$('refreshVersions').addEventListener('click',renderHistory);
$('exportLog').addEventListener('click',()=>{if(archive)download(current.title+'-审稿记录.json',JSON.stringify(archive,null,2))});
$('exportText').addEventListener('click',()=>{if(current)download(current.title+'-第'+currentNumber()+'集.txt',latestText()||$('source').value,'text/plain;charset=utf-8')});
$('exportWord').addEventListener('click',exportWord);
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});boot();