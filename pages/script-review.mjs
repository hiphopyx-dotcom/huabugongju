/** Client-side review UX for the Vercel studio. Keys and model calls stay on the server. */
const ESC=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const HEAD=/^第\s*[一二三四五六七八九十百千零〇两\d]+\s*集(?=\s|$|[：:、.·])/gm;
export function scriptParts(script){
  const text=String(script??''),matches=[...text.matchAll(HEAD)];
  if(!matches.length)return [{key:'全文',name:'全文',start:0,end:text.length,text}];
  const seen=new Map();
  return matches.map((m,index)=>{
    const name=m[0].replace(/\s+/g,''),occurrence=(seen.get(name)||0)+1;seen.set(name,occurrence);
    const start=index===0?0:m.index, end=index+1<matches.length?matches[index+1].index:text.length;
    return {key:name+'#'+occurrence,name,start,end,text:text.slice(start,end)};
  });
}
export function sealedPartsIntact(project,nextScript){
  const seals=project?.scriptSeals||{};
  if(!Object.keys(seals).length)return true;
  const parts=new Map(scriptParts(nextScript).map(p=>[p.key,p.text]));
  return Object.entries(seals).every(([key,seal])=>parts.get(key)===seal?.text);
}
async function textHash(text){
  const array=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(array)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const STAGES={write:'OpenAI初稿',review1:'Gemini独立初评',rewrite:'OpenAI按意见修订',review2:'Gemini独立复评',done:'已完成'};
export function createScriptReview({document,getProject,getUser,change,openModal,toast}){
  let selected='',run=null,configured=false,open=false,busy=false,stop=false,error='',statusText='';
  const parts=()=>scriptParts(getProject()?.script||'');
  const chosen=()=>parts().find(p=>p.key===selected)||parts()[0];
  async function api(action,body){
    const response=await fetch('/api/review?action='+encodeURIComponent(action),{
      method:body?'POST':'GET',credentials:'same-origin',
      headers:body?{'Content-Type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined,
    });
    let data;try{data=await response.json()}catch{throw Error('剧本评审服务响应错误')}
    if(!response.ok)throw Error(data.error||'评审服务暂不可用');
    return data;
  }
  async function getStatus(){
    const p=chosen();
    const data=await api('status&projectId='+encodeURIComponent(getProject().id)+'&partKey='+encodeURIComponent(p.key));
    configured=Boolean(data.configured);
    run=data.run;
  }
  const rating=()=>{
    if(!run?.review)return '';
    const v=run.review;
    return `<div class="notice"><strong>评审评分：${ESC(v.score)}分</strong> · ${run.passed?'通过95分+红线双门槛':'尚未达到验收标准'}
       ${(v.hardFailures||[]).length?`<p>硬伤：${ESC(v.hardFailures.join('；'))}</p>`:''}
       ${(v.issues||[]).length?`<p>问题：${ESC(v.issues.join('；'))}</p>`:''}
       ${(v.revisionInstructions||[]).length?`<p>修改指令：${ESC(v.revisionInstructions.join('；'))}</p>`:''}
    </div>`;
  };
  function render(){
    if(!open)return;
    const p=chosen(),sealed=Boolean(getProject()?.scriptSeals?.[p.key]);
    const opts=parts().map(part=>`<option value="${ESC(part.key)}" ${selected===part.key?'selected':''}>${ESC(part.name)}</option>`).join('');
    const progress=run?`<div class="notice"><strong>当前阶段：${ESC(STAGES[run.stage]||run.stage)}</strong>
      <p>初评分：${run.firstScore??'未评'} · 复评分：${run.score??'未评'} · ${run.adopted?'此版本已被采纳':run.passed?'符合95分验收线':'尚未通过'}</p></div>`:'<p class="muted">本集还没有独立评审记录。</p>';
    const versions=(run?.versions||[]).map((v,i)=>`<details style="margin:8px 0"><summary>${i+1}. ${ESC(v.step)} ${v.score===undefined?'':'· '+v.score+'分'}</summary>
      ${v.text?`<textarea readonly class="script-text" style="min-height:190px">${ESC(v.text)}</textarea>`:''}
      ${v.review?.issues?.length?`<p>${ESC(v.review.issues.join('；'))}</p>`:''}</details>`).join('');
    const lockedNote=sealed?'<p class="notice">该集已经封板，禁止直接覆盖；解封须单独确认。</p>':'';
    openModal(`<h2>剧本独立评审 · 分集封板</h2>
      <p class="muted">OpenAI写稿 → Gemini初评 → OpenAI按意见修订 → Gemini复评。每轮留档，达到95分且无硬伤才允许人工采纳。</p>
      <label class="field">选择分集<select data-review-select="part">${opts}</select></label>
      <div class="row wrap"><button type="button" data-review-action="toggle-seal">${sealed?'解封本集':'封板本集'}</button>
        <button type="button" data-review-action="start" ${busy||sealed||!configured?'disabled':''}>开始新一轮评审</button>
        ${run?.stage&&run.stage!=='done'? `<button type="button" data-review-action="continue" ${busy||sealed?'disabled':''}>从断点继续</button>`:''}
        ${busy?'<button type="button" data-review-action="pause">暂停后续阶段</button>':''}
      </div>
      ${lockedNote}
      ${configured?'':'<div class="notice">尚未配置两套服务端API密钥。当前只能使用本地质检；不可假称模型已接通。</div>'}
      <p class="muted">模型调用单次最多一个阶段，关闭后可恢复；每次调用会消耗对应平台的API额度。未知结果的超时重试可能重复计费。</p>
      ${statusText?`<p class="muted">${ESC(statusText)}</p>`:''}
      ${error?`<div class="notice">${ESC(error)}</div>`:''}
      ${progress}${rating()}${versions}
      ${run?.stage==='done'&&run.passed&&!run.adopted&&!sealed?`<button data-review-action="adopt" ${busy?'disabled':''}>人工确认采纳通过稿</button>`:''}
      ${run?.stage?.endsWith(':running')&&!busy?`<button data-review-action="retry" type="button">确认超时后重试阶段</button>`:''}
      <p class="muted">候选稿与正式稿分开存储。若原稿已变化或已封板，拒绝覆盖。</p>`,true);
  }
  function update(){if(open)render()}
  async function openPanel(){
    if(!getUser()){toast('请先使用正式工作台账户登录');return}
    selected=parts().find(part=>part.key===selected)?.key||parts()[0].key;
    error='';statusText='';open=true;
    try{await getStatus()}catch(e){error=e.message}
    update();
  }
  function reference(){
    const list=parts(),p=chosen(),index=list.findIndex(s=>s.key===p.key),project=getProject();
    return [
      '作品：'+(project.title||''),'题材：'+(project.settings?.genre||''),
      '长度要求：'+(project.settings?.words||'700–1000字'),'既定创作规则：'+(project.settings?.writing||''),
      '当前分集：'+p.name,
      index>0?'上一集最后部分：'+list[index-1].text.slice(-900):'',
      index+1<list.length?'下一集开头部分：'+list[index+1].text.slice(0,450):'',
    ].filter(Boolean).join('\n').slice(0,12000);
  }
  async function stages(){
    if(!run||busy)return;
    busy=true;stop=false;error='';
    try{
      for(let i=0;i<4;i++){
        if(stop||run.stage==='done'||run.stage?.endsWith(':running'))break;
        statusText='正在执行 '+(STAGES[run.stage]||run.stage)+'……';
        update();
        const response=await api('advance',{id:run.id});
        run=response.run;
        statusText='已保存 '+(STAGES[run.stage]||run.stage);
      }
    }catch(e){error=e.message}
    finally{busy=false;update()}
  }
  async function start(){
    if(busy)return;
    const p=chosen();if(getProject().scriptSeals?.[p.key])return toast('本集已封板，先解封');
    if(!configured)return toast('请先配置服务端 OpenAI/Gemini API 密钥');
    busy=true;error='';statusText='正在建立独立评审记录……';update();
    try{
      const result=await api('start',{
        projectId:getProject().id,partKey:p.key,requestId:crypto.randomUUID(),
        source:p.text,reference:reference(),
      });
      run=result.run;
    }catch(e){error=e.message;busy=false;update();return}
    busy=false;update();await stages();
  }
  async function adopt(){
    const part=chosen(),project=getProject();
    if(!run?.passed||run.stage!=='done'||run.partKey!==part.key)return toast('评审尚未完成或选择了不同的分集');
    if(project.scriptSeals?.[part.key])return toast('本集已封板，不能覆盖');
    const digest=await textHash(part.text);
    if(digest!==run.sourceHash)return toast('本集原稿已变更，请重新评审；旧版本已保留');
    if(!confirm('确定采纳95分通过稿？原稿会进入本地撤回历史，请先确认已核对候选内容。'))return;
    const saved=await api('adopt',{id:run.id,currentHash:digest});
    const now=getProject(),current=scriptParts(now.script).find(p=>p.key===part.key);
    if(now.id!==saved.projectId||!current||await textHash(current.text)!==saved.sourceHash||now.scriptSeals?.[part.key])throw Error('原稿已变化或封板，拒绝写入');
    const adopted=saved.candidate;
    if(typeof adopted!=='string'||!adopted.trim()||!adopted.includes(part.name))throw Error('候选稿没有原有集标题，禁止采纳');
    change(()=>{
      const live=getProject(),section=scriptParts(live.script).find(p=>p.key===part.key);
      if(!section||section.text!==current.text)throw Error('采纳前原稿又发生变化');
      live.script=live.script.slice(0,section.start)+adopted+live.script.slice(section.end);
      live.reviewAudit=[...(live.reviewAudit||[]),{id:run.id,partKey:part.key,score:run.score,at:Date.now()}].slice(-40);
    });
    run={...run,adopted:true};
    statusText='已人工采纳，可使用工具栏「撤回」恢复修改前版本。';update();
  }
  function toggleSeal(){
    const part=chosen(),project=getProject(),locked=Boolean(project.scriptSeals?.[part.key]);
    if(!confirm(locked?'确认解除该集的封板保护？':'确认封板本集？封板后任何更改本集正文的操作都会被阻止。'))return;
    change(()=>{
      const live=getProject();
      live.scriptSeals={...(live.scriptSeals||{})};
      if(locked)delete live.scriptSeals[part.key];
      else live.scriptSeals[part.key]={text:part.text,at:Date.now()};
    });
    statusText=locked?'已解封本集':'已封板本集';update();
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-review-action]');
    if(!button)return;
    event.preventDefault();
    const action=button.dataset.reviewAction;
    try{
      if(action==='pause'){stop=true;statusText='本阶段完成后暂停后续模型调用';update();return}
      if(action==='toggle-seal')toggleSeal();
      if(action==='start')await start();
      if(action==='continue')await stages();
      if(action==='adopt')await adopt();
      if(action==='retry'){
        if(!confirm('上次API请求可能已经计费。确认该任务至少3分钟未完成，并手动重试吗？'))return;
        await api('retry',{id:run?.id,confirm:true});await getStatus();update();
      }
    }catch(e){error=e.message;update()}
  });
  document.addEventListener('change',async event=>{
    if(!event.target.matches('[data-review-select="part"]'))return;
    selected=event.target.value;error='';statusText='';
    try{await getStatus()}catch(e){error=e.message}update();
  });
  return {open:openPanel};
}
