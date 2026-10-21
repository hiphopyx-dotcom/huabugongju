// Non-destructive UI folding for all studio views, user/admin modals, and virtual-stage panels.
// Folding changes visibility only: inputs, events, media and projects are never serialized or recreated.
const PREFIX='jbp-panels-v2:';
const SELECTOR=[
  '.section','.split > section','.asset-grid','.cards','.video-sequence',
  '.video-sequence-shot','article.shot','.clip-list','.workspace > .inspector',
  '.table-panel','.shot-guide-options','.vs-controls','.vs-viewer'
].join(',');
const PAGE_TITLES={
 home:'项目空间',models:'模型中心',cloud:'云端项目',grok:'图片生成',
 script:'剧本创作',assets:'素材库',canvas:'节点画布',shots:'分镜中心',
 video:'视频生成',editor:'时间线剪辑',tasks:'任务中心'
};
const FALLBACK={
 'section':'设置与内容','asset-grid':'素材与列表','cards':'卡片列表',
 'video-sequence':'多镜头编排','video-sequence-shot':'镜头设置',
 'shot':'分镜详情','clip-list':'时间线片段','inspector':'节点属性',
 'vs-controls':'虚拟片场操作','vs-viewer':'片场预览','table-panel':'任务列表',
 'shot-guide-options':'镜头语言选项'
};
const safe=s=>String(s??'').trim().replace(/\s+/g,' ').slice(0,62);
export function panelName(panel){
  if(panel.matches('article.shot'))return safe(panel.querySelector('h3')?.textContent||'分镜详情');
  if(panel.matches('.video-sequence-shot'))return safe(panel.querySelector(':scope > .row strong')?.textContent||'镜头设置');
  const heading=panel.querySelector(':scope > h2,:scope > h3,:scope > h4,:scope > .row h2,:scope > .row h3,:scope > header h2,:scope > header h3');
  if(heading)return safe(heading.textContent)||'内容区';
  const row=panel.querySelector(':scope > strong,:scope > .row > strong');
  if(row)return safe(row.textContent)||'内容区';
  if(panel.classList.contains('asset-grid')){
    const before=panel.previousElementSibling;
    const found=before?.querySelector?.('h2,h3,strong')||before?.matches?.('h2,h3')&&before;
    if(found)return safe(found.textContent);
  }
  const cls=Object.keys(FALLBACK).find(c=>panel.classList.contains(c));
  return FALLBACK[cls]||'功能区';
}
export function keyFor({projectId='guest',page='home',scope='main',name='section',position=0,sub=false}={}){
  return PREFIX+[projectId,page,scope,sub?'detail':'zone',position,safe(name)].map(x=>encodeURIComponent(String(x))).join('|');
}
export function decideState(raw,defaultClosed=false){
  if(raw==='closed')return 'closed';if(raw==='open')return 'open';
  return defaultClosed?'closed':'open';
}
function read(key){
  try{return localStorage.getItem(key)}catch{return null}
}
function write(key,state){
  try{localStorage.setItem(key,state)}catch{/* Private browser mode: current state still works. */}
}
function markItem(el,cls,yes){if(yes)el.classList.add(cls);else el.classList.remove(cls)}
function toggle(panel,open,persist=true){
  const next=open?'open':'closed';
  panel.dataset.jbpFoldState=next;
  const bar=[...panel.children].find(child=>child.classList.contains('jbp-fold-bar'));
  const button=bar?.querySelector('button[data-jbp-fold-toggle]');
  if(button){button.setAttribute('aria-expanded',String(open));button.textContent=open?'▾ 收起':'▸ 展开';button.setAttribute('aria-label',(open?'收起':'展开')+(panel.dataset.jbpFoldTitle||'内容区'))}
  if(persist&&panel.dataset.jbpFoldKey)write(panel.dataset.jbpFoldKey,next);
}
function toggleDetail(head,open,persist=true){
  head.dataset.jbpSubState=open?'open':'closed';
  const btn=head.querySelector('button[data-jbp-detail-toggle]');
  if(btn){btn.setAttribute('aria-expanded',String(open));btn.textContent=open?'▾':'▸';btn.setAttribute('aria-label',(open?'收起':'展开')+'详细设置 '+safe(head.dataset.jbpSubTitle))}
  const group=head.parentElement;
  if(group){
    let node=head.nextElementSibling;
    while(node&&!node.matches('h2,h3,h4,[data-jbp-fold-bar],[data-jbp-fold-global]')){
      markItem(node,'jbp-fold-detail-hidden',!open);node=node.nextElementSibling;
    }
  }
  if(persist&&head.dataset.jbpSubKey)write(head.dataset.jbpSubKey,open?'open':'closed');
}
function prepareTable(root){
  if(!root)return;
  // Tables cannot contain non-table markup, so a surrounding panel is used instead.
  for(const table of [...root.children].filter(child=>child.tagName==='TABLE')){
    if(table.closest('.table-panel'))continue;
    const wrapper=document.createElement('div');
    wrapper.className='table-panel';
    table.before(wrapper);wrapper.appendChild(table);
  }
}
function headingsIn(panel,env){
  if(!panel.matches('.vs-controls,.section,.split > section,.video-sequence,#modalBody'))return;
  const hs=[...panel.children].filter(e=>e.matches('h3,h4')&&e.textContent?.trim());
  if(hs.length<2)return;
  const panelKey=panel.dataset.jbpFoldKey||keyFor({...env,name:'modal-detail'});
  hs.forEach((h,i)=>{
    if(h.dataset.jbpSubKey)return;
    const title=safe(h.textContent),key=panelKey+':detail:'+i+':'+encodeURIComponent(title);
    h.dataset.jbpSubKey=key;h.dataset.jbpSubTitle=title;h.classList.add('jbp-fold-subtitle');
    const btn=document.createElement('button');btn.type='button';btn.className='jbp-fold-sub-toggle';
    btn.dataset.jbpDetailToggle='true';btn.title='展开或收起 '+title;
    h.appendChild(btn);
    toggleDetail(h,decideState(read(key),i>0)==='open',false);
  });
}
function findCandidates(root){
  if(!root)return [];
  return [...root.querySelectorAll(SELECTOR)].filter(panel=>panel.isConnected&&panel.children.length>0);
}
function sectionScope(panel){
  return panel.closest('.shot-guide-overlay')?'guide':panel.closest('.vs-overlay')?'stage':panel.closest('#modalBody')?'modal':'main';
}
function sectionContext(panel,ctx){
  const scope=sectionScope(panel),mod=document.querySelector('#modalBody > h2');
  return {projectId:safe(ctx.projectId)||'guest',page:scope==='main'?(ctx.page||'home'):scope==='stage'?'virtual-stage':scope==='guide'?'shot-guide':'modal-'+safe(mod?.textContent||'dialogue'),scope};
}
function enhancePanel(panel,ctx,ordinal){
  if(panel.dataset.jbpFoldKey){
    const bar=[...panel.children].find(child=>child.classList.contains('jbp-fold-bar'));
    if(bar){
      // Later-rendered elements must also stay hidden when the parent is collapsed.
      for(const child of [...panel.children])if(child!==bar&&!child.classList.contains('jbp-fold-content')&&!child.matches('.modal-close,h2'))child.classList.add('jbp-fold-content');
      return;
    }
    // An existing inspector/modal was re-rendered with innerHTML; restore controls and state.
    const priorState=panel.dataset.jbpFoldState,priorKey=panel.dataset.jbpFoldKey;
    delete panel.dataset.jbpFoldKey;delete panel.dataset.jbpFoldTitle;
    panel.classList.remove('jbp-fold-panel');
    enhancePanel(panel,ctx,ordinal);
    if(panel.dataset.jbpFoldKey===priorKey&&(priorState==='closed'||priorState==='open'))toggle(panel,priorState==='open',false);
    return;
  }
  const env=sectionContext(panel,ctx),name=panelName(panel);
  // Structural position stabilizes across render, even with repeated "镜头" headings.
  const id=panel.getAttribute('data-id')||panel.getAttribute('data-shot')||panel.id||String(ordinal);
  const stableId=panel.getAttribute('data-id')||panel.getAttribute('data-shot')||panel.id;
  const key=keyFor({...env,name:stableId?'stable-area':name,position:id});
  panel.dataset.jbpFoldKey=key;panel.dataset.jbpFoldTitle=name;
  const bar=document.createElement('div');bar.className='jbp-fold-bar';bar.dataset.jbpFoldBar='true';
  const title=document.createElement('span');title.className='jbp-fold-label';title.textContent=name;
  const btn=document.createElement('button');btn.type='button';btn.className='jbp-fold-switch';
  btn.dataset.jbpFoldToggle='true';btn.title='仅折叠本功能区';
  bar.append(title,btn);panel.prepend(bar);
  // Mark existing children, not by moving them: this preserves listeners and form values.
  for(const child of [...panel.children])if(child!==bar&&!child.matches('.modal-close,:scope > h2'))child.classList.add('jbp-fold-content');
  panel.classList.add('jbp-fold-panel');
  const dense=panel.matches('.asset-grid,.cards')&&panel.children.length>12;
  const defaultClosed=scope==='main'&&(dense||ordinal>=2||panel.matches('.video-sequence,.video-sequence-shot,article.shot')) ||scope==='modal'&&ordinal>=2;
  toggle(panel,decideState(read(key),defaultClosed)==='open',false);
}
function globalToolbar(target,ctx,scope){
  const container=scope==='stage'?target?.querySelector('.vs-dialog'):target;
  if(!container||[...container.children].some(child=>child.classList.contains('jbp-fold-global')))return;
  const panelCount=findCandidates(target).length;
  const innerCount=target.querySelectorAll('[data-jbp-sub-key]').length;
  // The canvas has one inspector: its local accordion is sufficient; do not overlay the node toolbar.
  if(target.matches('.canvas-workspace')&&panelCount<=1)return;
  if(panelCount+innerCount<1)return;
  const bar=document.createElement('div');bar.className='jbp-fold-global';bar.dataset.jbpFoldGlobal=scope;
  const caption=document.createElement('strong');caption.textContent='分区折叠';
  const label=document.createElement('span');label.className='jbp-fold-count';label.textContent=panelCount+' 个功能区';
  bar.append(caption,label);
  for(const [op,text] of [['open','全部展开'],['close','全部收起'],['reset','恢复默认']]){
    const btn=document.createElement('button');btn.type='button';btn.dataset.jbpFoldAll=op;btn.dataset.jbpFoldScope=scope;
    btn.textContent=text;bar.appendChild(btn);
  }
  container.prepend(bar);
}
function applyRegion(target,ctx,scope){
  prepareTable(target);
  const candidates=findCandidates(target);
  let mainIndex=0,stageIndex=0,modalIndex=0,guideIndex=0;
  for(const panel of candidates){
    const inScope=sectionScope(panel);
    if(inScope!==scope)continue;
    let ordinal=inScope==='main'?mainIndex++:inScope==='stage'?stageIndex++:inScope==='guide'?guideIndex++:modalIndex++;
    enhancePanel(panel,ctx,ordinal);
    headingsIn(panel,sectionContext(panel,ctx));
  }
  if(scope==='modal'){
    headingsIn(target,{projectId:ctx.projectId,page:'dialogue',scope:'modal'});
    // Lightweight dialogs without sub-sections still get a foldable content body.
    if(!candidates.some(panel=>sectionScope(panel)==='modal')&&target.children.length>2)enhancePanel(target,ctx,0);
  }
  if(scope!=='guide')globalToolbar(target,ctx,scope);
}
let observerMain=null,observerModal=null,observerBody=null,observerStage=null;
let scheduled=false,lastCtx=()=>({projectId:'guest',page:'home'});
function update(){
  const ctx=lastCtx();
  const main=document.querySelector('#main'),modal=document.querySelector('#modalBody'),stage=document.querySelector('.vs-overlay');
  if(main){
    for(const page of [...main.children].filter(child=>child.classList.contains('page')))applyRegion(page,ctx,'main');
    const canvas=[...main.children].find(child=>child.classList.contains('workspace')&&child.classList.contains('canvas-workspace'));
    if(canvas)applyRegion(canvas,ctx,'main');
  }
  if(modal)applyRegion(modal,ctx,'modal');
  if(stage)applyRegion(stage,ctx,'stage');
  const guide=document.querySelector('.shot-guide-overlay');
  if(guide)applyRegion(guide,ctx,'guide');
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;update()})}
function hasNewRelevant(mutations){
  return mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(
    m.target?.closest?.('[data-jbp-fold-key]')||
    n.matches?.('.page,.section,.asset-grid,.workspace,.vs-overlay,.shot-guide-overlay,.shot-guide-options,.vs-controls,.vs-viewer,.shot,.video-sequence,.table-panel,h3,h4')||
    n.querySelector?.('.page,.section,.asset-grid,.workspace,.vs-overlay,.vs-controls,.vs-viewer,.shot,.video-sequence')
  )));
}
function setAll(root,op){
  const fold=[...root.querySelectorAll('[data-jbp-fold-key]')],subs=[...root.querySelectorAll('[data-jbp-sub-key]')];
  const reset=op==='reset';
  for(const [index,panel] of fold.entries()){
    if(reset)try{localStorage.removeItem(panel.dataset.jbpFoldKey)}catch{}
    const state=reset?decideState(null,index>=2||panel.matches('.video-sequence,.video-sequence-shot,article.shot')):op==='open'?'open':'closed';
    toggle(panel,state==='open',!reset);
  }
  for(const [index,head] of subs.entries()){
    if(reset)try{localStorage.removeItem(head.dataset.jbpSubKey)}catch{}
    const state=reset?decideState(null,index>0):op==='open'?'open':'closed';
    toggleDetail(head,state==='open',!reset);
  }
}
export function install({context}={}){
  if(typeof context==='function')lastCtx=context;
  if(observerMain)return;
  const relevant=mutations=>{if(hasNewRelevant(mutations))schedule()};
  const main=document.querySelector('#main'),modal=document.querySelector('#modalBody');
  observerMain=new MutationObserver(relevant);if(main)observerMain.observe(main,{childList:true,subtree:true});
  observerModal=new MutationObserver(relevant);if(modal)observerModal.observe(modal,{childList:true,subtree:true});
  observerBody=new MutationObserver(ms=>{
    const added=ms.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&n.matches?.('.vs-overlay,.shot-guide-overlay')));
    if(!added)return;
    observerStage?.disconnect();
    const stage=document.querySelector('.vs-overlay,.shot-guide-overlay');
    if(stage){observerStage=new MutationObserver(relevant);observerStage.observe(stage,{childList:true,subtree:true})}
    schedule();
  });
  observerBody.observe(document.body,{childList:true});
  document.addEventListener('click',e=>{
    const one=e.target.closest('[data-jbp-fold-toggle]'),sub=e.target.closest('[data-jbp-detail-toggle]'),all=e.target.closest('[data-jbp-fold-all]');
    if(!one&&!sub&&!all)return;
    e.preventDefault();e.stopPropagation();
    if(one){const panel=one.closest('[data-jbp-fold-key]');if(panel)toggle(panel,panel.dataset.jbpFoldState!=='open')}
    else if(sub){const head=sub.closest('[data-jbp-sub-key]');if(head)toggleDetail(head,head.dataset.jbpSubState!=='open')}
    else {
      const scope=all.dataset.jbpFoldScope,root=scope==='main'?all.closest('.page,.workspace'):scope==='modal'?document.querySelector('#modalBody'):document.querySelector('.vs-overlay');
      if(root)setAll(root,all.dataset.jbpFoldAll);
    }
  },true);
  schedule();
}
export function refresh(){update()}
