// Visual-only components for the existing node canvas.
// All handlers, project data, geometry, and generation logic remain in app.mjs.
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = {
  text:['SCRIPT','剧本文本','把故事连接到角色、场景和分镜'],
  character:['CAST','人物参考','绑定角色参考图，锁定外观'],
  scene:['LOCATION','场景参考','为镜头指定环境与空间'],
  prop:['PROP','道具资产','绑定实物与关键道具'],
  image:['STORYBOARD','分镜图片','生成或引用静态画面'],
  video:['VIDEO','动态镜头','关联视频生成任务'],
  audio:['AUDIO','声音素材','管理音频参考'],
  output:['DELIVERY','合成输出','将素材送入剪辑时间线']
};
const tInfo = n => types[n.type] || ['ASSET','媒体节点',''];
const textOnly = s => String(s ?? '').trim().replace(/\s+/g,' ');
const count = (items) => Array.isArray(items) ? items.length : 0;
const label = (text, className='') => '<span class="' + className + '">' + escapeHTML(text) + '</span>';

export function card(n, ctx) {
  const info=tInfo(n), type=types[n.type] ? n.type : 'other';
  const refIds=Array.isArray(n.assetIds) ? n.assetIds : [];
  const primary=ctx.asset(n.resultAssetId) || refIds.map(ctx.asset).find(a=>a && a.kind!=='audio');
  const output=ctx.asset(n.resultAssetId);
  const prompt=textOnly(n.prompt);
  const inputCount=ctx.edges.filter(e=>e.to===n.id).length;
  const outputCount=ctx.edges.filter(e=>e.from===n.id).length;
  const disabled=Boolean(n.locked);
  const active=ctx.selected===n.id;
  const status=output?'已有结果':refIds.length?'已关联素材':prompt?'待生成':'待配置';
  const isText=n.type==='text';
  let stage='';
  if(primary){
    stage='<div class="node-media canvas-media">' + ctx.mediaHTML(primary) + '<span class="canvas-media-corner">' + escapeHTML(primary.name||'参考素材') + '</span></div>';
  }else if(isText){
    stage='<div class="canvas-script-preview"><span class="canvas-preview-eyebrow">STORY / TEXT</span><p>' + escapeHTML(prompt.slice(0,135) || '点击节点，在右侧写入或粘贴剧本内容。') + '</p></div>';
  }else{
    stage='<div class="canvas-node-empty canvas-empty-'+type+'"><span class="canvas-empty-icon" aria-hidden="true">'+
      escapeHTML(ctx.icons[n.type]||'◇')+'</span><span class="canvas-empty-title">'+escapeHTML(info[1])+'</span><small>'+
      escapeHTML(info[2])+'</small></div>';
  }
  const snippet=!isText && prompt ? '<div class="canvas-prompt-excerpt" title="'+escapeHTML(prompt.slice(0,300))+'">'+escapeHTML(prompt.slice(0,76))+'</div>' : '';
  return '<article class="node canvas-node canvas-type-'+type+(active?' selected':'')+(disabled?' locked':'')+
    '" data-node="'+escapeHTML(n.id)+'" style="left:'+Number(n.x||0)+'px;top:'+Number(n.y||0)+'px">'+
    '<div class="node-head canvas-node-head" data-drag="'+escapeHTML(n.id)+'" title="拖动节点">'+
    '<div class="canvas-node-ident"><span class="canvas-node-symbol" aria-hidden="true">'+escapeHTML(ctx.icons[n.type]||'◇')+'</span><div>'+
    '<small>'+escapeHTML(info[0])+'</small><strong>'+escapeHTML(n.name)+'</strong></div></div>'+
    '<span class="canvas-node-menu" aria-hidden="true">'+(disabled?'🔒':'⋮')+'</span></div>'+
    '<button class="port input" data-act="connect-in" data-id="'+escapeHTML(n.id)+'" aria-label="连接输入"></button>'+
    '<button class="port'+(ctx.linkFrom===n.id?' pending':'')+'" data-act="connect-out" data-id="'+escapeHTML(n.id)+'" aria-label="连接输出"></button>'+
    stage+snippet+
    '<div class="canvas-node-status"><span class="canvas-status-dot'+(output?' complete':'')+'"></span>'+escapeHTML(status)+
    '<span class="canvas-node-metrics">'+escapeHTML(refIds.length+' 素材')+'</span></div>'+
    '<div class="node-foot canvas-node-foot"><span>输入 '+inputCount+'</span><span>输出 '+outputCount+'</span>'+
    (n.params?.ratio && ['image','video'].includes(n.type) ? '<span>'+escapeHTML(n.params.ratio)+'</span>':'')+'</div></article>';
}

export function inspector(ctx) {
  const n=ctx.node;
  if(!n){
    return '<div class="canvas-inspector-kicker">WORKSPACE / INSPECTOR</div>'+
      '<h3 class="canvas-inspector-title">工作区概览</h3>'+
      '<p class="canvas-inspector-lead">选择一个节点，查看参考素材、编辑提示内容，并将它连接到下一步。</p>'+
      '<div class="canvas-inspector-stat-grid"><div><strong>'+ctx.totalNodes+'</strong><span>节点</span></div>'+
      '<div><strong>'+ctx.totalEdges+'</strong><span>连接</span></div><div><strong>'+ctx.totalAssets+'</strong><span>项目资产</span></div></div>'+
      '<div class="canvas-inspector-walkthrough">'+
      '<div><i>01</i><span>选择左侧节点查看详情</span></div>'+
      '<div><i>02</i><span>从右侧端口连接到下一节点的左侧端口</span></div>'+
      '<div><i>03</i><span>绑定参考资产，再进行生成或导出</span></div></div>'+
      '<div class="canvas-inspector-cta">'+ctx.button('＋ 添加节点','new-node','','full primary')+
      ctx.button('把分镜加入画布','shots-canvas','','full')+'</div>';
  }
  const info=tInfo(n);
  const refIds=Array.isArray(n.assetIds)?n.assetIds:[];
  const output=ctx.asset(n.resultAssetId);
  const status=output?'已有生成结果':refIds.length?'已绑定参考':n.prompt?'可继续配置':'尚未配置';
  const disabled=n.locked?'disabled':'';
  const inputs=ctx.inputs;
  const title='<div class="canvas-inspector-kicker">'+escapeHTML(info[0])+' / NODE INSPECTOR</div>'+
    '<div class="canvas-inspector-heading"><span class="canvas-inspector-glyph">'+escapeHTML(ctx.icons[n.type]||'◇')+'</span>'+
    '<div><h3>'+escapeHTML(n.name)+'</h3><small>'+escapeHTML(info[1])+' · '+escapeHTML(status)+'</small></div></div>';
  const media=output ? '<div class="canvas-inspector-preview">'+ctx.mediaHTML(output)+'</div>':'';
  const assetChips=refIds.map(id=>{const a=ctx.asset(id);return a?
    '<div class="asset-chip canvas-reference-chip">'+(a.kind==='image'?'<img src="'+escapeHTML(a.src)+'" alt="">':
    '<span class="canvas-asset-symbol">'+escapeHTML(ctx.icons[a.kind]||'◇')+'</span>')+
    '<span class="grow">'+escapeHTML(a.name)+'</span>'+ctx.button('×','unbind-node','data-id="'+escapeHTML(id)+'" '+disabled)+'</div>':''}).join('');
  const options=n.params||{};
  const mediaControls=['video','image'].includes(n.type)?
    '<div class="grid2 field"><div><label>时长（秒）</label><input data-node-param="duration" type="number" min="1" max="60" value="'+escapeHTML(options.duration??5)+'" '+disabled+'></div>'+
    '<div><label>画幅比例</label><select data-node-param="ratio" '+disabled+'>'+['16:9','9:16','1:1'].map(v=>'<option '+(options.ratio===v?'selected':'')+'>'+v+'</option>').join('')+'</select></div></div>'+
    '<div class="field"><label>首帧 / 尾帧</label><select data-node-param="firstFrame" '+disabled+'>'+ctx.assetOptions('image',options.firstFrame,'选择首帧')+'</select>'+
    '<select data-node-param="lastFrame" style="margin-top:8px" '+disabled+'>'+ctx.assetOptions('image',options.lastFrame,'选择尾帧')+'</select></div>':'';
  return title+media+
    '<div class="canvas-inspector-stat-grid canvas-inspector-stat-grid--compact"><div><strong>'+refIds.length+'</strong><span>参考资产</span></div>'+
    '<div><strong>'+Math.max(0,count(inputs?.nodes)-1)+'</strong><span>上游节点</span></div>'+
    '<div><strong>'+count(inputs?.assets)+'</strong><span>合并参考</span></div></div>'+
    '<div class="canvas-inspector-fields"><div class="field"><label>节点名称</label><input data-node-field="name" value="'+escapeHTML(n.name)+'" '+disabled+'></div>'+
    '<div class="field"><label>提示词 / 文本</label><textarea data-node-field="prompt" '+disabled+'>'+escapeHTML(n.prompt)+'</textarea></div>'+
    '<div class="field"><div class="canvas-field-heading"><label>绑定的参考资产</label><small>'+refIds.length+' 个</small></div>'+
    (assetChips||'<p class="canvas-field-empty">尚未绑定素材，使用下方按钮添加。</p>')+
    ctx.button('＋ 绑定资产','bind-node',disabled,'full')+'</div>'+
    mediaControls+
    '<div class="field"><label>上游输入</label><p class="canvas-field-empty">已连接 '+Math.max(0,count(inputs?.nodes)-1)+' 个上游节点，合并 '+count(inputs?.assets)+' 个参考资产。</p>'+
    ctx.button('查看输入数据','inspect-input','','full')+'</div></div>'+
    '<div class="canvas-inspector-actions"><div class="row wrap">'+
    ctx.button(n.locked?'解锁':'锁定','lock-node')+ctx.button('复制','duplicate-node')+
    ctx.button('删除','delete-node',disabled,'danger')+'</div>'+
    ctx.button(n.type==='output'?'打开合成时间线':'创建生成任务','node-task','','full primary')+'</div>';
}
