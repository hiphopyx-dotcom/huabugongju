import {splitEpisodes} from './chatgpt-handoff.mjs?v=bd900549f538';
import {normalizeWorkshopImport,inspectScript,WORKSHOP_IMPORT_LIMITS} from './story-workshop-core.mjs?v=bd900549f538';
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STEPS=[['setup','作品设定'],['create','剧本创作'],['manuscript','剧本正文'],['review','剧本质检'],['shots','拆分镜头']];
const FIELDS={premise:'故事梗概',logline:'一句话故事',tone:'整体基调',protagonistSeed:'主角与核心冲突',emotionWant:'观众情绪',outline:'故事大纲',characters:'人物小传',episodePlan:'分集规划',targetEpisodes:'目标集数'};
export function createScriptWorkbench({document,window,getProject,getUser,change,save,flush,writer,toast,openModal,closeModal,importProject,breakdown,goto,download}){
 let host=null,identity='',step='setup',partKey='',bridge=null,pendingImport=null,inputStarted=false;
 const key=()=>`${getUser()?.id||'guest'}:${getProject().id}`;
 const same=expected=>{if(expected!==key())throw Error('项目或账号已切换，请重新打开');};
 function stopBridge(){if(bridge){window.removeEventListener('message',bridge.receive);bridge=null;}pendingImport=null;}
 function unmount(){writer.unmount();stopBridge();host=null;}
 function currentParts(){return splitEpisodes(getProject().script);}
 function show(next){if(!STEPS.some(([id])=>id===next))return;step=next;render();}
 function render(target){
  if(target)host=target;if(!host?.isConnected)return;
  writer.unmount();stopBridge();if(identity!==key()){identity=key();step='setup';partKey='';}inputStarted=false;
  const p=getProject(),story=p.story||{},parts=currentParts(),count=p.script.trim()?parts.length:0;
  host.innerHTML=`<div class="script-workbench"><header class="workbench-heading"><div><span class="workbench-brand">剧爆棚 · 创作工作台</span><h1>把故事写成作品。</h1><p class="muted">设定、创作、正文与分镜，共用当前项目。</p></div><div class="row wrap"><button data-work="import">导入旧作品</button><button data-work="backup">备份作品</button></div></header><div class="workbench-project"><strong>${E(p.title)}</strong><span>${count} 集正文 · ${p.script.length.toLocaleString('zh-CN')} 字${story.targetEpisodes?' · 计划 '+E(story.targetEpisodes)+' 集':''}</span><span class="muted">自动保存在此浏览器</span></div><nav class="workbench-steps" aria-label="剧本创作流程">${STEPS.map(([id,label],i)=>`<button data-work="step" data-step="${id}" ${id===step?'aria-current="step" class="active"':''}><span>${i+1}</span>${label}</button>`).join('')}</nav><div class="workbench-content">${content(p,story,parts)}</div></div>`;
  host.onclick=event=>{const button=event.target.closest('[data-work]');if(!button||button.disabled)return;handle(button).catch(error=>toast(error.message));};
  host.onfocusin=()=>{inputStarted=false;};
  host.oninput=event=>{
   const el=event.target,d=el.dataset;if(!d.story&&!d.workSetting&&!d.workScript)return;
   try{same(identity);const apply=()=>{const project=getProject();if(d.story){project.story||={};project.story[d.story]=d.story==='targetEpisodes'?Math.max(0,Math.min(1000,Math.floor(Number(el.value)||0))):el.value;}else if(d.workSetting)project.settings[d.workSetting]=el.value;else project.script=el.value;};
    if(!inputStarted){change(apply,false);inputStarted=true;}else{apply();save();}
    if(d.workScript){const label=host.querySelector('[data-work-count]');if(label)label.textContent=el.value.length.toLocaleString('zh-CN')+' 字';}
   }catch(error){toast(error.message);}
  };
  if(step==='create')writer.mount(host.querySelector('[data-inline-writer]'),partKey?{partKey}:{}).catch(error=>toast(error.message));
 }
 function field(name,rows=3){const value=getProject().story?.[name]??'';return `<label class="field">${FIELDS[name]}${name==='targetEpisodes'?`<input type="number" min="0" max="1000" data-story="${name}" value="${E(value)}">`:`<textarea data-story="${name}" rows="${rows}" placeholder="填写${FIELDS[name]}，创作时会一起带入">${E(value)}</textarea>`}</label>`;}
 function content(p,story,parts){
  if(step==='setup')return `<section class="section"><div class="row wrap"><div><h2>先把作品定下来</h2><p class="muted">这里的设定会随写作任务发送，人物和故事保持在同一条线上。</p></div><span class="spacer"></span><button class="primary" data-work="create">带着设定开始创作 →</button></div><div class="grid2"><label class="field">题材<input data-work-setting="genre" value="${E(p.settings.genre||'')}" placeholder="例如：悬疑 / 都市情感"></label>${field('targetEpisodes')}${field('logline')}${field('tone')}${field('protagonistSeed')}${field('emotionWant')}</div>${field('premise',4)}<div class="grid2">${field('outline',8)}${field('characters',8)}</div>${field('episodePlan',6)}<details class="workbench-rules"><summary>写作规范与制作要求</summary><label class="field">单集长度<input data-work-setting="words" value="${E(p.settings.words||'700–1000 字')}"></label><label class="field">写作要求<textarea data-work-setting="writing" rows="4" placeholder="动作、对白、节奏、成本及结尾要求">${E(p.settings.writing||'')}</textarea></label><p class="muted">人物动机清楚；动作可拍；同场连续动作合并；开头有冲突，结尾有悬念。所有候选稿经你采纳后才进入正文。</p></details></section>`;
  if(step==='create')return `<section class="section workbench-inline"><div class="workbench-context"><span>沿用本项目的故事大纲、人物小传与分集规划</span><button data-work="step" data-step="setup" class="soft">修改设定</button><button data-work="step" data-step="manuscript" class="soft">查看正文</button></div><div data-inline-writer></div></section>`;
  if(step==='manuscript')return `<section class="section"><div class="row wrap"><h2>正式剧本</h2><span class="spacer"></span><span data-work-count>${p.script.length.toLocaleString('zh-CN')} 字</span><button data-work="export">导出 DOCX</button><button data-work="step" data-step="review">检查剧本 →</button></div><p class="muted">手动修改和已采纳的候选稿都保存在这份正文里。Word 导出固定为宋体、小四、1.5 倍行距。</p><div class="workbench-manuscript"><aside aria-label="分集目录">${parts.map(part=>`<button data-work="episode" data-key="${E(part.key)}">${E(part.label)}</button>`).join('')}<button data-work="create" class="primary">＋ 继续创作</button></aside><label class="field"><span class="sr-only">剧本正文</span><textarea data-work-script="true" rows="24" spellcheck="false" placeholder="第1集\n1-1 日 内 客厅\n人物：…\n△动作\n人物：台词">${E(p.script)}</textarea></label></div></section>`;
  if(step==='review'){
   const issues=inspectScript(p.script);
   return `<section class="section"><div class="row wrap"><h2>剧本质检</h2><span class="spacer"></span><button data-work="diagnose" class="primary">让模型诊断当前分集</button></div><p class="muted">以下仅检查文字格式与明显遗漏。人物动机、情节逻辑与创作质量需结合模型诊断和人工判断。</p>${story.reviewReport?`<details open><summary>已保存的模型诊断报告</summary><textarea readonly rows="10" aria-label="模型诊断报告">${E(story.reviewReport)}</textarea></details>`:''}<div class="workbench-checks">${issues.map(issue=>`<button data-work="line" data-line="${issue.line}" class="workbench-check"><span>${issue.level==='warning'?'待检查':'提示'} · 第 ${issue.line} 行</span><strong>${E(issue.message)}</strong><small>定位正文 →</small></button>`).join('')||'<p class="notice">未发现规则覆盖范围内的明显格式问题。可继续检查剧情和人物逻辑。</p>'}</div><div class="row wrap"><button data-work="step" data-step="manuscript">返回正文</button><button data-work="step" data-step="shots">进入分镜 →</button></div></section>`;
  }
  return `<section class="section"><h2>从正文走向画面</h2><p class="muted">直接使用当前项目的正式剧本拆分镜头，生成后的分镜、白模与视频继续沿用同一项目。</p><div class="workbench-handoff"><div><span class="workbench-stage-number">01</span><h3>确认正文</h3><p>${p.script.length.toLocaleString('zh-CN')} 字 · ${p.script.trim()?parts.length:0} 集</p><button data-work="step" data-step="manuscript">查看 / 修改</button></div><div><span class="workbench-stage-number">02</span><h3>拆分镜头</h3><p>按片场拆出人物、场景、道具和连续分镜，或提交模型拆镜。</p><div class="row wrap"><button data-work="local" ${p.script.trim()?'':'disabled'}>按片场拆解</button><button data-work="ai" class="primary" ${p.script.trim()?'':'disabled'}>模型拆镜</button></div></div><div><span class="workbench-stage-number">03</span><h3>制作画面</h3><p>已有 ${p.shots.length} 个分镜 · ${p.assets.length} 个资产</p><button data-work="shots">打开分镜管理 →</button></div></div></section>`;
 }
 async function handle(button){
  const expected=identity;same(expected);const action=button.dataset.work;
  if(action==='step')return show(button.dataset.step);
  if(action==='create'||action==='diagnose'){step='create';render();if(action==='diagnose')await writer.mount(host.querySelector('[data-inline-writer]'),{kind:'review',partKey});return;}
  if(action==='episode'){const part=currentParts().find(p=>p.key===button.dataset.key);if(!part)return;partKey=part.key;const editor=host.querySelector('[data-work-script]');editor.focus();editor.setSelectionRange(part.start,part.end);editor.scrollTop=Math.max(0,getProject().script.slice(0,part.start).split('\n').length-2)*26;return;}
  if(action==='line'){const line=Number(button.dataset.line)||1;show('manuscript');const editor=host.querySelector('[data-work-script]'),lines=editor.value.split('\n'),at=lines.slice(0,line-1).join('\n').length+(line>1?1:0);editor.focus();editor.setSelectionRange(at,at+(lines[line-1]?.replace(/\r$/,'').length||0));editor.scrollTop=Math.max(0,line-3)*26;return;}
  if(action==='local'||action==='ai'){await flush();same(expected);return action==='local'?breakdown.local():breakdown.aiSetup();}
  if(action==='shots')return goto('shots');
  if(action==='backup')return download('backup');
  if(action==='export')return download('script');
  if(action==='import')return importDialog();
 }
 function importDialog(){
  stopBridge();const expected=key();
  openModal(`<h2>导入旧作品</h2><p class="muted">大纲、人物、分集与正文会一起进入新项目，当前作品会保留。含图片、视频的完整项目备份，请从项目空间恢复。</p><div class="row wrap"><button data-import="library" class="primary" ${getUser()?'':'disabled'}>选择旧作品库中的作品</button><label class="workbench-file">导入写作资料 JSON / TXT<input type="file" data-import-file accept=".json,.txt,application/json,text/plain"></label></div>${getUser()?'':'<p class="notice">请先登录，才能读取属于你的旧作品库。</p>'}<div data-import-frame></div><div data-import-preview></div><p data-import-error class="form-error" role="alert"></p>`,true);
  const modal=document.querySelector('#modalBody');
  modal.onclick=async event=>{const button=event.target.closest('[data-import]');if(!button)return;try{same(expected);if(button.dataset.import==='library')openLibrary(modal,expected);if(button.dataset.import==='confirm'){if(!pendingImport)throw Error('请先选择作品');const data=pendingImport;pendingImport=null;button.disabled=true;await importProject(data,expected);stopBridge();closeModal();toast('作品已导入为新项目，原作品保留');}}catch(error){const el=modal.querySelector('[data-import-error]');if(el)el.textContent=error.message;button.disabled=false;}};
  modal.onchange=async event=>{if(!event.target.matches('[data-import-file]'))return;try{same(expected);const file=event.target.files?.[0];if(!file)return;if(file.size>WORKSHOP_IMPORT_LIMITS.bytes)throw Error('文件超过16MB，请分开导入');const raw=await file.text();same(expected);if(!modal.isConnected||!modal.querySelector('[data-import-preview]'))return;preview(file.name.toLowerCase().endsWith('.txt')?{version:2,title:file.name.replace(/\.txt$/i,''),script:raw,settings:{}}:raw,modal);}catch(error){modal.querySelector('[data-import-error]').textContent=error.message;}};
 }
 function preview(raw,modal){
  pendingImport=null;const data=normalizeWorkshopImport(raw);pendingImport=data;
  modal.querySelector('[data-import-preview]').innerHTML=`<section class="section"><h3>${E(data.title)}</h3><p>${data.script.length.toLocaleString('zh-CN')} 字正文${data.story.targetEpisodes?' · 计划 '+E(data.story.targetEpisodes)+' 集':''}</p><p class="muted">${['premise','outline','characters','episodePlan'].filter(k=>data.story[k]).map(k=>FIELDS[k]).join(' · ')||'只有剧本正文'}</p><label class="field">正文预览<textarea readonly rows="5">${E(data.script.slice(0,1500))}</textarea></label><button data-import="confirm" class="primary">导入为新项目</button></section>`;
 }
 function openLibrary(modal,expected){
  stopBridge();const nonce=crypto.randomUUID(),slot=modal.querySelector('[data-import-frame]');
  slot.innerHTML='<p class="muted">请在作品库中选择作品，再确认导入。</p><iframe class="workbench-library" title="选择我的旧作品" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
  const frame=slot.querySelector('iframe');
  const receive=event=>{if(event.source!==frame.contentWindow||event.origin!==window.location.origin||event.data?.type!=='jbp-project-import'||event.data.nonce!==nonce||!frame.isConnected)return;try{same(expected);preview(event.data.bundle,modal);}catch(error){modal.querySelector('[data-import-error]').textContent=error.message;}};
  bridge={receive};window.addEventListener('message',receive);
  frame.src='/api/accounts?action=module-open&module=script&intent=project-import&nonce='+encodeURIComponent(nonce);
 }
 return {render,show,unmount};
}
