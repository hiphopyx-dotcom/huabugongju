import {buildHandoff,splitEpisodes,adoptChatResult} from './chatgpt-handoff.mjs?v=74aaa9591dc5';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function assertWritingOwner(record,project,user){
 if(!user||record.ownerId!==user.id||record.projectId!==project.id)throw Error('项目或账号已切换，请回到提交任务的项目查看结果');
}
export function createLanguageWriting({document,accounts,getProject,change,flush,openModal,toast,onAdopt}){
 let session=null,poll=null,busy=false,kind='next',partKey='',requirement='',prompt='',error='',embeddedHost=null;
 const find=selector=>(embeddedHost||document.querySelector('#modalBody')||document).querySelector(selector);
 function stop(){clearTimeout(poll);const root=activeRoot();if(session&&root?.querySelector('#writingSession')?.dataset.session===session.id)root.replaceChildren();poll=null;session=null;embeddedHost=null;busy=false;}
 const current=()=>getProject();
 const activeRoot=()=>embeddedHost||document.querySelector('#modalBody');
 const ownsTarget=target=>!activeRoot()?.contains||activeRoot().contains(target);
 function check(){if(!session)throw Error('请重新打开写作区域');assertWritingOwner(session,current(),accounts.current());if(embeddedHost&&!embeddedHost.isConnected)throw Error('写作区域已关闭，请重新打开')}
 function prepared(){return buildHandoff(current(),{kind,scope:'episode',partKey,requirement})}
 function visible(){return !!(session&&(!embeddedHost||embeddedHost.isConnected)&&find('#writingSession')?.dataset.session===session.id&&(embeddedHost||document.querySelector('#modal')?.style.display!=='none')&&accounts.current()?.id===session.ownerId&&current().id===session.projectId)}
 function records(){return (current().languageModelJobs||[]).filter(j=>j.ownerId===session.ownerId&&j.projectId===session.projectId)}
 function render(){
  check();clearTimeout(poll);
  let preview;try{preview=prepared()}catch(e){error=e.message}
  const jobs=records();
  const html=`<h2>剧本创作</h2><div id="writingSession" data-session="${session.id}"><p class="muted">在这里发送写作要求，回复会自动显示在下方。生成稿先保留为候选，核对后再采纳。</p><p id="writingConnection" role="status">正在检查服务连接…</p><div class="grid2"><label class="field">创作任务<select id="writingKind">${Object.entries({next:'续写下一集',rewrite:'精修所选单集',review:'质量诊断',outline:'大纲与人物小传'}).map(([v,t])=>`<option value="${v}" ${v===kind?'selected':''}>${t}</option>`).join('')}</select></label><label class="field">参考分集<select id="writingPart">${splitEpisodes(current().script).map(p=>`<option value="${E(p.key)}" ${p.key===(partKey||preview?.sourceKey)?'selected':''}>${E(p.label)}</option>`).join('')}</select></label></div><label class="field">补充要求<textarea id="writingRequirement" rows="2">${E(requirement)}</textarea></label><details><summary>查看或修改本次发送内容 · 最多8,000字</summary><label class="field">发送内容<textarea id="writingPrompt" rows="8">${E(prompt||preview?.prompt||'')}</textarea></label></details><p class="notice" data-quota-meter="text" data-source="writingPrompt"></p><p id="writingError" role="alert" class="form-error">${E(error)}</p><button data-writing="send" class="primary full" ${busy?'disabled':''}>${busy?'正在提交…':'发送给语言模型'}</button><div class="row wrap"><h3>本项目写作任务</h3><button data-writing="refresh">刷新结果</button></div><div id="writingJobs">${jobs.slice(-8).reverse().map(j=>`<section class="section"><strong>${E({submitting:'待确认提交',queued:'排队中',running:'生成中',done:'已收到回复',failed:'未完成'}[j.status]||'待查询')}</strong><small> · ${E(j.sourceLabel)} · ${new Date(j.created).toLocaleString('zh-CN')}</small>${j.result?`<label class="field">候选结果<textarea readonly rows="9">${E(j.result)}</textarea></label><p class="muted">${j.adoptedAt?(['next','rewrite'].includes(j.kind)?'已采纳并保存正式剧本':'已保存到创作资料'):'候选稿已保存在本项目，正式剧本未自动修改'}</p>${['next','rewrite'].includes(j.kind)?`<button data-writing="adopt" data-id="${E(j.requestId)}" ${j.adoptedAt||j.adminLocked?'disabled':''}>核对后采纳正文</button>`:['outline','review'].includes(j.kind)?`<button data-writing="reference" data-id="${E(j.requestId)}" ${j.adoptedAt||j.adminLocked?'disabled':''}>${j.kind==='outline'?'采纳到故事大纲':'保存诊断报告'}</button>`:''}`:''}${j.error?`<p class="form-error">${E(j.error)}</p>`:''}${j.status==='submitting'?`<button data-writing="retry" data-id="${E(j.requestId)}">确认提交状态 / 重试</button>`:''}</section>`).join('')||'<p class="muted">本项目还没有写作任务。</p>'}</div></div>`;
  if(embeddedHost)embeddedHost.innerHTML=html;else openModal(html,true);
  return find('#writingSession');
 }
 async function status(marker){try{const s=await accounts.generationApi('status',null,{channel:'script'});if(visible()&&find('#writingSession')===marker)find('#writingConnection').textContent=s.online?'语言模型已连接，可以发送。':'语言模型暂未连接，请联系管理员。'}catch(e){if(visible()&&find('#writingSession')===marker)find('#writingConnection').textContent=e.message}}
 async function refresh(){
  if(!visible()||busy)return;const active=session,host=find('#writingSession');
  try{const pending=records().filter(j=>j.jobId&&!['done','failed'].includes(j.status));
   const results=await Promise.all(pending.map(j=>accounts.generationApi('job',null,{id:j.jobId}).then(r=>({record:j,job:r.job}))));
   if(active!==session||!visible()||find('#writingSession')!==host)return;
   if(results.some(({record,job})=>record.status!==job.status||record.result!==job.result||record.adminLocked!==job.adminLocked)){
    change(()=>{check();for(const {record,job} of results){Object.assign(record,{status:job.status,result:job.result,error:job.error,adminLocked:job.adminLocked})}},false);await flush();
    if(active===session&&visible()){const marker=render();status(marker)}
   }
  }catch(e){if(active===session&&visible())find('#writingError').textContent=e.message}
  finally{if(active===session&&visible()&&records().some(j=>['queued','running'].includes(j.status)))poll=setTimeout(refresh,2500)}
 }
 async function submit(record){
  check();if(busy)return;busy=true;error='';const owner=session;
  let marker=render();status(marker);
  try{await flush();if(owner!==session||!visible())return;check();
   const response=await accounts.generationApi('submit',{channel:'script',prompt:record.prompt,requestId:record.requestId});
   if(owner!==session)return;check();
   change(()=>{check();Object.assign(record,{jobId:response.job.id,status:response.job.status,result:response.job.result,error:response.job.error})},false);await flush();
  }catch(e){if(owner===session)error=e.message}
  finally{if(owner===session)busy=false;if(owner===session&&visible()){marker=render();status(marker);refresh()}}
 }
 document.addEventListener('change',e=>{
  if(!['writingKind','writingPart'].includes(e.target?.id)||!visible()||busy||!ownsTarget(e.target))return;
  check();requirement=find('#writingRequirement').value;
  if(e.target.id==='writingKind')kind=e.target.value;else partKey=e.target.value;
  prompt='';error='';const marker=render();status(marker);refresh();
 });
 document.addEventListener('input',e=>{
  if(!visible()||!ownsTarget(e.target))return;
  if(e.target?.id==='writingPrompt')prompt=e.target.value;
  if(e.target?.id==='writingRequirement'){requirement=e.target.value;prompt='';try{find('#writingPrompt').value=prepared().prompt}catch(err){find('#writingError').textContent=err.message}}
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-writing]');if(!button||!visible()||!ownsTarget(button))return;e.preventDefault();const active=session;
  try{check();if(busy)return;const action=button.dataset.writing;
   if(action==='refresh'){await refresh();return}
   if(action==='retry'){const record=records().find(j=>j.requestId===button.dataset.id);if(!record)throw Error('任务记录不存在');await submit(record);return}
   if(action==='send'){
    const source=prepared(),text=find('#writingPrompt').value;
    if(!text.trim()||text.length>8000)throw Error('请输入1–8000字；当前内容已完整保留，请缩短参考内容后发送');
    // Persist the immutable destination and original script before the network request.
    const referenceKey=source.kind==='outline'?'outline':'reviewReport';
    const record={...source,referenceSnapshot:String(current().story?.[referenceKey]||''),id:session.id,requestId:crypto.randomUUID(),ownerId:session.ownerId,projectId:session.projectId,prompt:text,selectedSnapshot:splitEpisodes(current().script).find(p=>p.key===source.sourceKey)?.text,created:Date.now(),status:'submitting'};
    change(()=>{check();current().languageModelJobs=[...(current().languageModelJobs||[]),record]},false);await submit(record);return;
   }
   if(action==='reference'){
    const record=records().find(j=>j.requestId===button.dataset.id);if(!record||record.status!=='done'||!record.result||record.adminLocked||!['outline','review'].includes(record.kind))throw Error('参考结果尚不能采纳');
    assertWritingOwner(record,current(),accounts.current());if(record.adoptedAt)throw Error('此候选已采纳');const key=record.kind==='outline'?'outline':'reviewReport';
    if(record.referenceSnapshot===undefined||String(current().story?.[key]||'')!==record.referenceSnapshot)throw Error('创作资料已经变化，请先备份候选结果，避免覆盖人工修改');
    if(!window.confirm(record.kind==='outline'?'确认将这个候选保存到故事大纲？原有正式剧本会保留。':'确认保存这份诊断报告？正式剧本会保留。'))return;
    change(()=>{check();assertWritingOwner(record,current(),accounts.current());current().story||={};current().story[key]=record.result;record.adoptedAt=Date.now()},false);await flush();
    if(active!==session||!visible())return;const marker=render();status(marker);toast('已保存创作资料');await onAdopt?.(record);return;
   }
   if(action==='adopt'){
    const record=records().find(j=>j.requestId===button.dataset.id);if(!record||record.status!=='done'||!record.result||record.adminLocked)throw Error('候选结果尚不能采纳');
    assertWritingOwner(record,current(),accounts.current());if(record.adoptedAt)throw Error('此候选已采纳');
    const result=adoptChatResult(current().script,record,record.result);
    if(!window.confirm('确认将候选正文采纳到当前项目？请先核对剧情、集数和内容。'))return;
    change(()=>{check();assertWritingOwner(record,current(),accounts.current());if(current().script!==record.scriptSnapshot)throw Error('原稿已经变化，禁止覆盖');current().script=result;record.adoptedAt=Date.now()},false);await flush();
    if(active!==session||!visible())return;const marker=render();status(marker);toast('已采纳并保存剧本');await onAdopt?.(record);
   }
  }catch(e){if(active!==session)return;error=e.message;if(visible())find('#writingError').textContent=error;else toast(error)}
 });
 function begin(host,options={}){
  stop();embeddedHost=host;session={id:crypto.randomUUID(),ownerId:accounts.current().id,projectId:current().id};kind=['next','rewrite','review','outline'].includes(options.kind)?options.kind:'next';partKey=String(options.partKey||'');prompt='';requirement=String(options.requirement||'');error='';const marker=render();status(marker);return refresh();
 }
 return {async open(){if(!accounts.current())return accounts.textGeneration();await begin(null)},async mount(host,options={}){if(!host||!host.isConnected)throw Error('写作区域尚未打开');if(!accounts.current()){stop();host.innerHTML='<p class="notice">请先登录后开始创作。</p><button data-account="login" class="primary">手机号登录</button>';return}await begin(host,options)},unmount:stop,close:stop};
}
