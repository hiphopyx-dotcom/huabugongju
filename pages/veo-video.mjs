// Actual video provider integration. All API credentials stay in the server function.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trim=x=>String(x??'').trim();
const states={submitting:'提交中（不可重复）',queued:'已受理',polling:'刷新状态中',running:'生成中',succeeded:'可审核下载',failed:'生成失败',uncertain:'结果不明，禁止自动重试',cancelled:'已停止跟踪'};
const modelOptions=[['veo-3.1-fast-generate-preview','Veo 3.1 Fast（快速）'],['veo-3.1-generate-preview','Veo 3.1（质量）']];
const idList=(project,ids)=>ids.map(id=>project.assets.find(a=>a.id===id&&a.kind==='image')).filter(Boolean);
const selectedFrames=(project,ids)=>idList(project,ids).sort((a,b)=>Number(!!b.locked)-Number(!!a.locked)).slice(0,3);
export function planVideoJobs(project,source='video'){
  if(source==='storyboard'){
    const settings=project.settings||{},images=project.assets||[],globalPrompt=trim(settings.videoPrompt);
    const validIds=ids=>(ids||[]).filter(id=>images.some(a=>a.id===id&&a.kind==='image'));
    return (project.shots||[]).slice(0,2000).map((shot,index)=>{
      const characters=validIds(shot.characters),locations=validIds(shot.locations),props=validIds(shot.props);
      const first=validIds([shot.firstFrame])[0]||'',last=validIds([shot.lastFrame])[0]||'';
      const extra=selectedFrames(project,[...characters,...locations,...props,...(settings.videoRefs||[])]).map(a=>a.id);
      let mode='text',refs=[],firstId='',lastId='';
      if(first&&last){mode='interpolate';firstId=first;lastId=last}
      else if(first||validIds([shot.assetId])[0]){mode='start';firstId=first||validIds([shot.assetId])[0]}
      else if(extra.length){mode='references';refs=extra}
      const name=trim(shot.episode)||'未分集',scene=trim(shot.scene)||'未指定场景';
      const prompt=[globalPrompt,'所属分集：'+name,'场景：'+scene,shot.description&&'画面动作：'+shot.description,
        shot.dialogue&&'对白：'+shot.dialogue,shot.size&&'景别：'+shot.size,shot.angle&&'机位：'+shot.angle,
        shot.camera&&'运镜：'+shot.camera,shot.continuity&&'连续性：'+shot.continuity,
        shot.characterNames?.length&&'角色：'+shot.characterNames.join('、'),
        shot.locationNames?.length&&'场景设定：'+shot.locationNames.join('、'),
        shot.sourceText&&'原文约束：'+shot.sourceText.slice(0,300),
        '保持已锁定角色外貌、服装、发型与场景布局；不随意增加人物、不越轴、动作方向与上一镜一致。']
        .filter(Boolean).join('\n').slice(0,3200);
      return {shotId:shot.id,shotLabel:name+' · '+scene+' · '+(index+1)+'号分镜',
        episode:name,mode,firstId,lastId,refIds:refs,
        referenceIds:[...new Set([firstId,lastId,...refs].filter(Boolean))],
        duration:8,requestedDuration:Number(shot.duration)||5,prompt,ratio:shot.ratio||settings.videoRatio||'9:16'};
    });
  }
  const s=project.settings||{},ratio=s.videoRatio||'16:9',refIds=Array.isArray(s.videoRefs)?s.videoRefs:[],method=s.videoMethod||'图生视频';
  const title=project.title||'未命名作品',prompt=trim(s.videoPrompt);
  const normalize=(shot,index)=>{
    const label=shot?'镜头 '+(index+1):'整体视频',shotId=shot?.id||'';
    const text=trim([prompt,shot?.description,shot?.camera&&'运镜：'+shot.camera].filter(Boolean).join('\n'));
    const ids=shot?.assetId?[shot.assetId]:refIds;
    const firstId=shot?.assetId||s.firstFrame||ids[0]||'';
    let mode='text',first='',last='',refs=[];
    if(shot?.assetId){mode='start';first=firstId}
    else if(method==='首尾帧'){mode='interpolate';first=s.firstFrame||'';last=s.lastFrame||''}
    else if(method==='多参考图'){mode='references';refs=selectedFrames(project,ids).map(a=>a.id)}
    else if(method==='图生视频'){mode='start';first=firstId}
    const referencedIds=[...new Set([first,last,...refs].filter(Boolean))];
    return {shotId,shotLabel:label+' · '+title,mode,firstId:first,lastId:last,referenceIds:referencedIds,refIds:refs,
      duration:8,requestedDuration:Number(shot?.duration||s.videoDuration||5),
      prompt:[text,'固定人物身份、发型、服装、年龄、场景布局和光线风格；避免换脸、多余肢体、衣服突变、突兀跳切。镜头内动作遵循分镜，不任意添加人物。'].filter(Boolean).join('\n'),ratio};
  };
  if(s.videoSequence&&Array.isArray(s.videoShots)&&s.videoShots.length)return s.videoShots.map(normalize);
  return [normalize(null,0)];
}
export async function compressImage(src,maxBytes=700000){
  if(!/^data:image\/(png|jpeg|webp);base64,/.test(src||''))throw Error('参考图不是可用的PNG/JPEG/WebP数据');
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('参考图无法解码'));image.src=src});
  if(!img.naturalWidth||!img.naturalHeight)throw Error('图片尺寸无效');
  for(const side of [960,768,600,480]){
    const scale=Math.min(1,side/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [.82,.7,.55]){
      const encoded=canvas.toDataURL('image/jpeg',quality);
      if(encoded.length*3/4<maxBytes)return encoded;
    }
  }
  throw Error('参考图片过大，无法压到750KB以内，请手动缩小图片');
}
async function request(action,body,params={}){
  const url='/api/video?'+new URLSearchParams({action,...params});
  const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',
    headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  let data;try{data=await response.json()}catch{throw Error('视频任务接口返回格式错误')}
  if(!response.ok)throw Error(data.error||'视频请求失败');
  return data;
}
async function file(id){
  const response=await fetch('/api/video?'+new URLSearchParams({action:'download',id}),{credentials:'same-origin'});
  if(!response.ok){const text=await response.json().catch(()=>({}));throw Error(text.error||'视频已过期或下载失败')}
  const blob=await response.blob();
  if(!blob.size||blob.size>65000000)throw Error('视频为空或超过65MB，请通过官方平台单独下载');
  return blob;
}
function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader;r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('视频文件读取失败'));r.readAsDataURL(blob)})}
export function createVideoHub({getProject,getAccount,change,flush,openModal,toast,addClip}){
  let rows=[],configured=false,busy=false,opened=false,chosen=new Set(),note='',model=modelOptions[0][0],previewUrl='',openedProject='';
  const p=()=>getProject();
  const plans=()=>planVideoJobs(p(),source);
  const render=()=>{
    if(!opened)return;
    const current=plans(),episodes=[...new Set(current.map(x=>x.episode).filter(Boolean))];
    const visible=current.map((v,i)=>({v,i})).filter(({v})=>!episodeFilter||v.episode===episodeFilter).slice(0,100);
    const list=visible.map(({v,i})=>'<label class="field"><input type="checkbox" data-veo-check="'+i+'" '+(chosen.has(i)?'checked':'')+' style="width:auto"> '+esc(v.shotLabel)+' · '+esc(v.mode)+' · '+esc(v.requestedDuration)+'秒目标（单次生成8秒）</label>').join('');
    const cards=rows.map(r=>{
      const done=r.status==='succeeded';
      return '<article class="section" style="margin:10px 0"><div class="row wrap"><strong>'+esc(r.shotLabel||'整体视频')+'</strong><span class="spacer"></span><small>'+esc(states[r.status]||r.status)+'</small></div><small>'+esc(r.model)+' · '+esc(r.duration)+'秒 · '+new Date(r.created).toLocaleString('zh-CN')+'</small>'+
        (r.error?'<p class="notice">'+esc(r.error)+'</p>':'')+
        '<div class="row wrap">'+(!['succeeded','cancelled','failed','uncertain'].includes(r.status)?'<button data-veo-action="poll" data-id="'+esc(r.id)+'">查询进度</button>':'')+
        (done?'<button data-veo-action="preview" data-id="'+esc(r.id)+'">预览视频</button><button data-veo-action="import" data-id="'+esc(r.id)+'">审核通过 · 入时间线</button><button data-veo-action="download" data-id="'+esc(r.id)+'">下载MP4</button>':'')+
        (['queued','running'].includes(r.status)?'<button data-veo-action="cancel" data-id="'+esc(r.id)+'">停止跟踪</button>':'')+'</div></article>';
    }).join('');
    openModal('<h2>Veo 视频批量生成 · 镜头任务</h2><p class="muted">每个镜头独立生成，不是把多个镜头一次提交给模型。参考图可压缩上传；人物一致性仍需人工审核。单次Veo生成8秒，目标5秒镜头可在时间线裁切。</p>'+
      (!configured?'<p class="notice">Veo API 未配置或服务端未上线。此处不提供假生成：请管理员设置 GEMINI_API_KEY 并完成数据库迁移。</p>':'<p class="notice">已检测到服务端密钥配置；实际是否有Veo使用权限需真实请求验证，提交会产生API费用。</p>')+
      '<label class="field">生成来源<select data-veo-source><option value="storyboard" '+(source==='storyboard'?'selected':'')+'>项目分镜表（逐镜）</option><option value="video" '+(source==='video'?'selected':'')+'>视频页镜头编排</option></select></label>'+
      (source==='storyboard'&&episodes.length?'<label class="field">筛选分集<select data-veo-episode>'+episodes.map(name=>'<option value="'+esc(name)+'" '+(episodeFilter===name?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>':'')+
      '<label class="field">视频模型<select data-veo-model>'+modelOptions.map(([id,label])=>'<option value="'+esc(id)+'" '+(id===model?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
      '<section class="section"><h3>待生成镜头</h3>'+list+'<div class="row wrap"><button data-veo-action="all" type="button">选全部</button><button data-veo-action="none" type="button">清空选择</button><button data-veo-action="submit" '+(!configured||busy?'disabled':'')+'>确认提交（单次最多3镜）</button></div></section>'+
      (note?'<p class="notice">'+esc(note)+'</p>':'')+
      '<div class="row wrap"><h3>服务器任务历史</h3><button data-veo-action="refresh" '+(busy?'disabled':'')+'>刷新列表</button></div>'+cards+
      '<p class="muted">提交超时不会自动再次付费请求；查询进度只查询已有任务。生成视频在模型平台保留时间有限，请及时下载或导入素材库。未实际下载入项目的结果不会自动出现在剪辑时间线。</p>',true);
  };
  const refresh=async()=>{
    const pid=openedProject;
    const result=await request('jobs',null,{projectId:pid});
    if(p().id!==pid)throw Error('项目已切换，请重新打开视频中心');
    rows=result.jobs;configured=result.configured;render();
  };
  async function start(){
    if(!getAccount()){toast('请先在正式工作台登录手机号账户');return}
    openedProject=p().id;source=p().shots?.length?'storyboard':'video';episodeFilter=source==='storyboard'?trim(p().shots[0]?.episode)||'未分集':'';chosen=new Set(plans().map((v,i)=>({v,i})).filter(x=>!episodeFilter||x.v.episode===episodeFilter).slice(0,3).map(x=>x.i));note='';opened=true;
    try{await refresh()}catch(e){note=e.message;configured=false;render()}
  }
  async function submit(){
    if(busy)return;
    const items=plans(),indexes=[...chosen].filter(i=>items[i]).sort((a,b)=>a-b);
    if(!indexes.length)return toast('至少选择一个镜头');
    if(indexes.length>3)return toast('为避免误扣费，单次最多提交3镜头，请分批生成');
    if(!confirm('即将向Veo提交'+indexes.length+'条分别计费的视频任务（每条8秒），确定继续吗？'))return;
    busy=true;note='正在准备参考图……';render();
    const pid=openedProject;let ok=0;
    try{
      for(const i of indexes){
        if(p().id!==pid)throw Error('项目已切换，停止提交');
        const v=items[i],project=p();
        if(!v.prompt.trim())throw Error('镜头'+(i+1)+'缺少生成提示词');
        if(v.ratio==='1:1')throw Error('Veo暂不支持1:1，请选择16:9或9:16');
        const images=new Map();
        for(const id of [v.firstId,v.lastId,...v.refIds].filter(Boolean)){
          const image=project.assets.find(a=>a.id===id&&a.kind==='image');
          if(!image)throw Error('第'+(i+1)+'镜参考图已被删除');
          images.set(id,await compressImage(image.src));
        }
        const requestId=crypto.randomUUID();
        note='正在提交第'+(i+1)+'镜；如网络中断请先检查任务列表，避免重复扣费。';render();
        await request('start',{projectId:pid,requestId,shotId:v.shotId,shotLabel:v.shotLabel,model,mode:v.mode,
          prompt:v.prompt,ratio:v.ratio,first:images.get(v.firstId)||'',last:images.get(v.lastId)||'',
          refs:v.refIds.map(id=>images.get(id)),referenceIds:v.referenceIds});
        ok++;
        await refresh();
      }
      note='已提交'+ok+'条真实异步任务。可使用查询进度，生成成功后需人工确认并导入时间线。';
    }catch(e){note='已确认提交'+ok+'条；当前步骤未完成：'+e.message+'。若出现网络错误请先刷新列表，避免重复扣费。'}
    finally{busy=false;render()}
  }
  const job=id=>rows.find(x=>x.id===id);
  const down=async(id)=>{
    const blob=await file(id),url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=(p().title||'剧爆棚')+'-'+(job(id)?.shotLabel||'镜头')+'.mp4';
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  const preview=async(id)=>{
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(await file(id));
    openModal('<h2>人工审核 · '+esc(job(id)?.shotLabel)+'</h2><p>请逐项检查角色身份、面容、服装、动作方向、连续性、镜头时长及声音。确认后再将素材写入项目。</p><video controls playsinline style="width:100%;max-height:64vh" src="'+esc(previewUrl)+'"></video><div class="row wrap"><button data-veo-action="import" data-id="'+esc(id)+'">审核通过 · 入时间线</button><button data-veo-action="back">返回任务中心</button></div>',true);
  };
  const importJob=async id=>{
    const j=job(id);
    if(!j||j.status!=='succeeded'||j.projectId!==p().id)throw Error('只有本项目成功生成的视频可导入');
    if(p().videoImports?.[id])return toast('该镜头已经导入本项目，避免重复');
    if(j.shotId&&!p().settings.videoShots?.some(s=>s.id===j.shotId)&&!p().shots?.some(s=>s.id===j.shotId)){
      if(!confirm('原镜头编排已变更。仍要把旧结果作为独立视频素材导入时间线吗？'))return;
    }
    if(!confirm('已经观看并检查视频质量，确定将这一版加入项目素材库及时间线？'))return;
    const blob=await file(id);
    if(blob.size>40000000)throw Error('单个视频超过40MB，建议先下载MP4，并使用“上传视频/音频”导入，避免浏览器存储空间不足');
    const src=await dataUrl(blob);
    if(p().id!==openedProject)throw Error('项目已切换，拒绝将视频写入其他项目');
    const asset={id:crypto.randomUUID(),kind:'video',type:'视频',name:j.shotLabel+' · Veo 生成.mp4',src,duration:j.duration,created:Date.now(),
      locked:false,tags:'Veo,AI视频,待人工复核',description:'AI生成视频；关联任务 '+id+'；由用户审核后导入，不等于保证人物或镜头无误'};
    change(()=>{
      const live=p();
      if(live.id!==openedProject||live.videoImports?.[id])throw Error('项目切换或任务已经导入');
      live.assets.push(asset);
      live.videoImports={...(live.videoImports||{}),[id]:asset.id};
      addClip(asset,{duration:Math.min(j.duration,Math.max(.1,Number([...planVideoJobs(p(),'storyboard'),...planVideoJobs(p(),'video')].find(x=>x.shotId===j.shotId)?.requestedDuration)||j.duration)),
        name:j.shotLabel});
    });
    await flush();
    note='已加入素材库和时间线；可在剪辑页继续裁切、配音和导出。';render();
  };
  document.addEventListener('change',e=>{
    if(e.target.matches('[data-veo-check]')){const index=Number(e.target.dataset.veoCheck);e.target.checked?chosen.add(index):chosen.delete(index)}
    if(e.target.matches('[data-veo-model]'))model=e.target.value;
    if(e.target.matches('[data-veo-source]')){source=e.target.value;episodeFilter=source==='storyboard'?plans()[0]?.episode||'':'';chosen.clear();render()}
    if(e.target.matches('[data-veo-episode]')){episodeFilter=e.target.value;chosen.clear();render()}
  });
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-veo-action]');if(!btn)return;
    e.preventDefault();
    const action=btn.dataset.veoAction,id=btn.dataset.id;
    try{
      if(action==='back'){render();return}
      if(action==='all'){chosen=new Set(plans().map((v,i)=>({v,i})).filter(x=>!episodeFilter||x.v.episode===episodeFilter).slice(0,100).map(x=>x.i));render();return}
      if(action==='none'){chosen.clear();render();return}
      if(action==='submit'){await submit();return}
      if(action==='refresh'){await refresh();return}
      if(action==='poll'){const r=await request('poll',{id});note=r.note||'最新状态：'+(states[r.job.status]||r.job.status);await refresh();return}
      if(action==='cancel'){if(!confirm('只停止工作台跟踪，Google侧仍可能计费，确定继续？'))return;const r=await request('cancel',{id});note=r.note||'已停止';await refresh();return}
      if(action==='preview'){await preview(id);return}
      if(action==='download'){await down(id);return}
      if(action==='import'){await importJob(id);return}
    }catch(err){note=err.message;render();toast(err.message)}
  });
  return {open:start};
}
