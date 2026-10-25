import {buildHandoff,splitEpisodes,adoptChatResult} from './chatgpt-handoff.mjs?v=mac-writing-20261025a';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function assertWritingOwner(record,project,user){
 if(!user||record.ownerId!==user.id||record.projectId!==project.id)throw Error('项目或账号已切换，请回到提交任务的项目查看结果');
}
export function createLanguageWriting({document,accounts,getProject,change,flush,openModal,toast}){
 let session=null,poll=null,busy=false,kind='next',partKey='',requirement='',prompt='',error='';
 const current=()=>getProject();
 function check(){if(!session)throw Error('请重新打开写作窗口');assertWritingOwner(session,current(),accounts.current())}
 function prepared(){return buildHandoff(current(),{kind,scope:'episode',partKey,requirement})}
 function visible(){return session&&document.querySelector('#writingSession')?.dataset.session===session.id&&document.querySelector('#modal').style.display!=='none'&&accounts.current()?.id===session.ownerId&&current().id===session.projectId}
 function records(){return (current().languageModelJobs||[]).filter(j=>j.ownerId===session.ownerId&&j.projectId===session.projectId)}
 function render(){
  check();clearTimeout(poll);
  let preview;try{preview=prepared()}catch(e){error=e.message}
  const jobs=records();
  openModal(`<h2>语言模型写剧本</h2><div id="writingSession" data-session="${session.id}"><p class="muted">在这里发送写作要求，回复会自动显示在下方。生成稿先保留为候选，核对后再采纳。</p><p id="writingConnection" role="status">正在检查服务连接…</p><div class="grid2"><label class="field">创作任务<select id="writingKind">${Object.entries({next:'续写下一集',rewrite:'精修所选单集',review:'质量诊断',outline:'大纲与人物小传'}).map(([v,t])=>`<option value="${v}" ${v===kind?'selected':''}>${t}</option>`).join('')}</select></label><label class="field">参考分集<select id="writingPart">${splitEpisodes(current().script).map(p=>`<option value="${E(p.key)}" ${p.key===(partKey||preview?.sourceKey)?'selected':''}>${E(p.label)}</option>`).join('')}</select></label></div><label class="field">补充要求<textarea id="writingRequirement" rows="2">${E(requirement)}</textarea></label><details><summary>查看或修改本次发送内容 · 最多8,000字</summary><label class="field">发送内容<textarea id="writingPrompt" rows="8">${E(prompt||preview?.prompt||'')}</textarea></label></details><p id="writingError" role="alert" class="form-error">${E(error)}</p><button data-writing="send" class="primary full" ${busy?'disabled':''}>${busy?'正在提交…':'发送给语言模型'}</button><div class="row wrap"><h3>本项目写作任务</h3><button data-writing="refresh">刷新结果</button></div><div id="writingJobs">${jobs.slice(-8).reverse().map(j=>`<section class="section"><strong>${E({submitting:'待确认提交',queued:'排队中',running:'生成中',done:'已收到回复',failed:'未完成'}[j.status]||'待查询')}</strong><small> · ${E(j.sourceLabel)} · ${new Date(j.created).toLocaleString('zh-CN')}</small>${j.result?`<label class="field">候选结果<textarea readonly rows="9">${E(j.result)}</textarea></label><p class="muted">${j.adoptedAt?'已采纳并保存正式剧本':'候选稿已保存在本项目，正式剧本未自动修改'}</p>${['next','rewrite'].includes(j.kind)?`<button data-writing="adopt" data-id="${E(j.requestId)}" ${j.adoptedAt||j.adminLocked?'disabled':''}>核对后采纳正文</button>`:''}`:''}${j.error?`<p class="form-error">${E(j.error)}</p>`:''}${j.status==='submitting'?`<button data-writing="retry" data-id="${E(j.requestId)}">确认提交状态 / 重试</button>`:''}</section>`).join('')||'<p class="muted">本项目还没有写作任务。</p>'}</div></div>`,true);
  return document.querySelector('#writingSession');
 }
 async function status(marker){try{const s=await accounts.generationApi('status',null,{channel:'script'});if(visible()&&document.querySelector('#writingSession')===marker)document.querySelector('#writingConnection').textContent=s.online?'语言模型已连接，可以发送。':'语言模型暂未连接，请联系管理员。'}catch(e){if(visible())document.querySelector('#writingConnection').textContent=e.message}}
 async function refresh(){
  if(!visible()||busy)return;const active=session,host=document.querySelector('#writingSession');
  try{const pending=records().filter(j=>j.jobId&&!['done','failed'].includes(j.status));
   const results=await Promise.all(pending.map(j=>accounts.generationApi('job',null,{id:j.jobId}).then(r=>({record:j,job:r.job}))));
   if(active!==session||!visible()||document.querySelector('#writingSession')!==host)return;
   if(results.some(({record,job})=>record.status!==job.status||record.result!==job.result||record.adminLocked!==job.adminLocked)){
    change(()=>{check();for(const {record,job} of results){Object.assign(record,{status:job.status,result:job.result,error:job.error,adminLocked:job.adminLocked})}},false);await flush();
    const marker=render();status(marker);
   }
  }catch(e){if(active===session&&visible())document.querySelector('#writingError').textContent=e.message}
  finally{if(active===session&&visible()&&records().some(j=>['queued','running'].includes(j.status)))poll=setTimeout(refresh,2500)}
 }
 async function submit(record){
  check();if(busy)return;busy=true;error='';const owner=session;
  let marker=render();status(marker);
  try{await flush();check();
   const response=await accounts.generationApi('submit',{channel:'script',prompt:record.prompt,requestId:record.requestId});
   if(owner!==session)return;check();
   change(()=>{check();Object.assign(record,{jobId:response.job.id,status:response.job.status,result:response.job.result,error:response.job.error})},false);await flush();
  }catch(e){error=e.message}
  finally{busy=false;if(owner===session&&visible()){marker=render();status(marker);refresh()}}
 }
 document.addEventListener('change',e=>{
  if(!['writingKind','writingPart'].includes(e.target?.id)||!visible()||busy)return;
  check();requirement=document.querySelector('#writingRequirement').value;
  if(e.target.id==='writingKind')kind=e.target.value;else partKey=e.target.value;
  prompt='';error='';const marker=render();status(marker);refresh();
 });
 document.addEventListener('input',e=>{
  if(!visible())return;
  if(e.target?.id==='writingPrompt')prompt=e.target.value;
  if(e.target?.id==='writingRequirement'){requirement=e.target.value;prompt='';try{document.querySelector('#writingPrompt').value=prepared().prompt}catch(err){document.querySelector('#writingError').textContent=err.message}}
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-writing]');if(!button)return;e.preventDefault();
  try{check();if(busy)return;const action=button.dataset.writing;
   if(action==='refresh'){await refresh();return}
   if(action==='retry'){const record=records().find(j=>j.requestId===button.dataset.id);if(!record)throw Error('任务记录不存在');await submit(record);return}
   if(action==='send'){
    const source=prepared(),text=document.querySelector('#writingPrompt').value;
    if(!text.trim()||text.length>8000)throw Error('请输入1–8000字；当前内容已完整保留，请缩短参考内容后发送');
    // Persist the immutable destination and original script before the network request.
    const record={...source,id:session.id,requestId:crypto.randomUUID(),ownerId:session.ownerId,projectId:session.projectId,prompt:text,selectedSnapshot:splitEpisodes(current().script).find(p=>p.key===source.sourceKey)?.text,created:Date.now(),status:'submitting'};
    change(()=>{check();current().languageModelJobs=[...(current().languageModelJobs||[]),record]},false);await submit(record);return;
   }
   if(action==='adopt'){
    const record=records().find(j=>j.requestId===button.dataset.id);if(!record||record.status!=='done'||!record.result||record.adminLocked)throw Error('候选结果尚不能采纳');
    assertWritingOwner(record,current(),accounts.current());if(record.adoptedAt)throw Error('此候选已采纳');
    const result=adoptChatResult(current().script,record,record.result);
    if(!window.confirm('确认将候选正文采纳到当前项目？请先核对剧情、集数和内容。'))return;
    change(()=>{check();assertWritingOwner(record,current(),accounts.current());if(current().script!==record.scriptSnapshot)throw Error('原稿已经变化，禁止覆盖');current().script=result;record.adoptedAt=Date.now()});await flush();
    const marker=render();status(marker);toast('已采纳并保存剧本');
   }
  }catch(e){error=e.message;if(visible())document.querySelector('#writingError').textContent=error;else toast(error)}
 });
 return {async open(){if(!accounts.current())return accounts.textGeneration();clearTimeout(poll);session={id:crypto.randomUUID(),ownerId:accounts.current().id,projectId:current().id};kind='next';partKey='';prompt='';requirement='';error='';const marker=render();status(marker);await refresh()}};
}
