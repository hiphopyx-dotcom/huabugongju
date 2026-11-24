export const untouched = [
  "public/bench/providers.mjs",
  "public/bench/provider-settings.mjs",
  "public/bench/index.html",
];

const accountsGeneration = `export async function generationApi(action,body,params={}){if(!enabled)throw Error('文字生成仅在正式账户版可用');const r=await benchFetch('/api/generation?'+new URLSearchParams({action,...params}),{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{throw Error('生成服务响应异常（HTTP '+r.status+'，返回的不是 JSON）')}if(!r.ok)throw Error(user?.role==='admin'?(data.error||'生成请求失败'):memberError(data.error||'生成请求失败'));return data}`;

const accountsGenerationNext = `const workbenchText=createTextLane();
const WORKBENCH_TEXT=new Set(['status','jobs','job','submit']);
export async function generationApi(action,body,params={}){if(!enabled)throw Error('文字生成仅在正式账户版可用');if(WORKBENCH_TEXT.has(action))return workbenchText(action,body,params);const r=await benchFetch('/api/generation?'+new URLSearchParams({action,...params}),{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{throw Error('生成服务响应异常（HTTP '+r.status+'，返回的不是 JSON）')}if(!r.ok)throw Error(user?.role==='admin'?(data.error||'生成请求失败'):memberError(data.error||'生成请求失败'));return data}`;

const pushVault = `async function pushVault(){if(!P||P.shareReadonly||isUntouchedSeed(P))return;let packed;try{packed=packForCloud(P)}catch{return}const user=typeof Accounts!=='undefined'?Accounts.current?.():null;if(!user||(user.role!=='admin'&&!user.phone))return;try{await fetch('/api/bench-members',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...cloudHeaders()},body:JSON.stringify({action:'vault-save',project:packed})})}catch{}try{const res=await fetch('/api/bench-members',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...cloudHeaders()},body:JSON.stringify({action:'project-save',project:packed,revision:Number(P.cloudRevision)||0})});const data=await res.json().catch(()=>({}));if(res.ok&&data.revision)P.cloudRevision=Number(data.revision);else if((res.status===409||data.conflict)&&Number(data.revision)>0)P.cloudRevision=Number(data.revision)}catch{}}`;

const pushVaultNext = `async function pushVault(){if(!P||P.shareReadonly||isUntouchedSeed(P)||autoSaveBlocked(P))return;let packed;try{packed=packForCloud(P)}catch{return}const user=typeof Accounts!=='undefined'?Accounts.current?.():null;if(!user||(user.role!=='admin'&&!user.phone))return;try{const res=await fetch('/api/bench-members',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...cloudHeaders()},body:JSON.stringify({action:'project-save',project:packed,revision:Number(P.cloudRevision)||0})});const data=await res.json().catch(()=>({}));const noted=noteSaveResponse(P,{status:res.status,ok:res.ok,conflict:data.conflict,revision:data.revision});P.cloudRevision=noted.cloudRevision;P.cloudConflict=noted.cloudConflict;if(!noted.vault)return;await fetch('/api/bench-members',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...cloudHeaders()},body:JSON.stringify({action:'vault-save',project:packed})})}catch{}}`;

export const replacements = [
  {
    dest: "public/bench/accounts.mjs",
    before: "0cd9668f6dd9e50a0c00fe1ef92abb6f8153e53519ce1b750300eb0c126ce87a",
    after: "92063405c63365a5e80e9509211d9e169ed1a6afdbc0bc605b6dc9b6dcd569ba",
    steps: [
      {
        old: "import {memberError} from './model-privacy.mjs';\n",
        new: "import {memberError} from './model-privacy.mjs';\nimport {createTextLane} from './custom-text-lane.mjs';\n",
      },
      { old: accountsGeneration, new: accountsGenerationNext },
    ],
  },
  {
    dest: "public/bench/custom-api-models.mjs",
    before: "24ceca8b2a1e49bd9998b6607c12b27b8bf5799b2703aa79803b4f4f4216f183",
    after: "6ac169bf4d6dbff84fde9efe61040c5a308c66f10ba48081638ad55d734c9ce4",
    steps: [
      {
        old: "/* 剧爆棚 /bench：自定义 OpenAI 兼容 API（切换 / 添加模型）\n",
        new: "import { isBlockedProvider as blockedHost } from \"./provider-block.mjs\";\n/* 剧爆棚 /bench：自定义 OpenAI 兼容 API（切换 / 添加模型）\n",
      },
      {
        old: `export function isBlockedProvider(baseUrl) {
  try {
    const host = new URL(normalizeBaseUrl(baseUrl)).hostname;
    return BLOCKED_HOSTS.test(host);
  } catch {
    return false;
  }
}`,
        new: `export function isBlockedProvider(baseUrl) {
  return blockedHost(baseUrl);
}`,
      },
    ],
  },
  {
    dest: "public/bench/app.mjs",
    before: "f6a1d2f8751eb717a9a3ba8a126010cae602df1da45e47df3708755361186145",
    after: "3c7c7a5f54a790287d3468bf7a00e1a20a8f8a2b4d2f62ec55e8ec23551d01b3",
    resume: [{ hash: "f2d64152e2bc0143375d9ecd8de5b6e1da38948d62f08ba5838783b73f4c332d", from: 4 }],
    steps: [
      {
        old: "import {packForCloud, isUntouchedSeed} from './project-pack.mjs';\n",
        new: "import {packForCloud, isUntouchedSeed} from './project-pack.mjs';\nimport {shouldCopyGuestLibrary} from './guest-adopt-guard.mjs';\nimport {autoSaveBlocked, noteSaveResponse} from './cloud-conflict.mjs';\n",
      },
      {
        old: "if(projectScope!=='guest'){try{const names=indexedDB.databases?await indexedDB.databases():null;if(!names||names.some(db=>db&&db.name==='jubaopeng-studio-v2'))await take(await readOtherProjects('jubaopeng-studio-v2'))}catch{}}",
        new: "if(projectScope!=='guest'&&shouldCopyGuestLibrary(projectScope)){try{const names=indexedDB.databases?await indexedDB.databases():null;if(!names||names.some(db=>db&&db.name==='jubaopeng-studio-v2'))await take(await readOtherProjects('jubaopeng-studio-v2'))}catch{}}",
      },
      { old: pushVault, new: pushVaultNext },
      {
        old: "const doc=data.project;doc.cloudRevision=Number(data.revision)||Number(doc.cloudRevision)||1;stripEphemeral(doc);",
        new: "const doc=data.project;doc.cloudRevision=Number(data.revision)||Number(doc.cloudRevision)||1;doc.cloudConflict=null;stripEphemeral(doc);",
      },
      {
        old: "import {packForCloud, isUntouchedSeed} from './project-pack.mjs';\n",
        new: "import {packForCloud, isUntouchedSeed} from './project-pack.mjs';\nimport {acceptQueuedJob, pagePollDecision, planVideoPageSubmit, providerAllowsEnqueue, videoChoiceRequest, videoPollRequest, videoSubmitRequest} from './video-page-refs.mjs';\nimport {videoThumbSrc} from './video-page-refs.mjs';\n",
      },
      {
        old: "function videoPage(){",
        new: "function videoPageThumb(asset){const src=videoThumbSrc(asset,galleryDataUrl);return src?`<img src=\"${E(src)}\" alt=\"${E(asset?.name||'')}\" loading=\"eager\" decoding=\"sync\">`:'<p class=\"media-gap\">没有读出像素</p>'}function videoPage(){",
      },
      {
        old: "支持一次选择多张，也可分次追加；上传后自动勾选。首帧、尾帧各一张，多镜头请在下方编排。",
        new: "支持一次选择多张，也可分次追加；上传后自动勾选。图生视频和全能参考只发送 1 张；首尾帧只发送首帧和尾帧 2 张；多参考图最多 14 张；文生视频不发送图片。能看见或勾选更多，也不会多发。没读出像素会在提交前停下。",
      },
      {
        old: "<div class=\"asset-preview\">${mediaHTML(a)}</div><div class=\"row\" style=\"margin-top:12px\"><input type=\"checkbox\" class=\"video-ref\"",
        new: "<div class=\"asset-preview\">${videoPageThumb(a)}</div><div class=\"row\" style=\"margin-top:12px\"><input type=\"checkbox\" class=\"video-ref\"",
      },
      {
        old: "actions['video-generate']=async e=>{if(page==='canvas'){const n=node(actNodeId(e));if(!n||n.type!=='video')return toast('请先选中视频节点');return runVideoNode(n)}if(uiBusy)return;let data;try{data=videoTaskData()}catch(e){return toast(e.message)}const first=data.params.method==='首尾帧'?asset(data.params.firstFrame):data.params.method==='参考视频'?null:asset(data.params.firstFrame)||data.assetIds.map(id=>asset(id)).find(a=>a?.kind==='image');const last=data.params.method==='首尾帧'?asset(data.params.lastFrame):null;const clip=data.params.method==='参考视频'?asset(data.params.videoReference):null;const image=first?.src&&(/^(data:image\\/|https?:)/.test(first.src))?first.src:'';const lastFrame=last?.src&&(/^(data:image\\/|https?:)/.test(last.src))?last.src:'';const video=clip?.src&&(/^(data:video\\/|https?:)/.test(clip.src))?clip.src:'';const spoken=voicedVideoPrompt();const raw=String(P.settings.videoPrompt||'');const extra=raw&&data.prompt.startsWith(raw)?data.prompt.slice(raw.length).trim():'';const prompt=[spoken,extra].filter(Boolean).join('\\n\\n');const paintProgress=(percent,label)=>{const bar=document.querySelector('#videoProgressBar'),text=document.querySelector('#videoProgressText'),pct=document.querySelector('#videoProgressPct');if(bar)bar.style.width=Math.max(0,Math.min(100,percent))+'%';if(text)text.textContent=label;if(pct)pct.textContent=Math.round(Math.max(0,Math.min(100,percent)))+'%'};uiBusy=true;const started=Date.now(),expect=Math.max(28000,Math.max(1,Math.min(15,Number(data.params.duration)||5))*7000);openModal(`<h2>正在生成视频</h2><p id=\"videoProgressText\">正在提交画面和声音…</p><div style=\"height:10px;border-radius:999px;background:#2a241c;overflow:hidden;margin:14px 0 8px\"><div id=\"videoProgressBar\" style=\"height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#c9a36a,#f3e2c2)\"></div></div><p id=\"videoProgressPct\" style=\"font-variant-numeric:tabular-nums\">0%</p><p class=\"muted\">请留在这一页。生成完成后视频会出现在资产中心。</p>`);const timer=setInterval(()=>{const ratio=Math.min(.92,(Date.now()-started)/expect);paintProgress(ratio*100,Date.now()-started<2500?'正在提交画面和声音…':'正在生成画面和声音…')},200);try{const submit=await fetch('/api/pianchang-video',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,aspect:data.params.ratio,duration:data.params.duration,resolution:data.params.resolution,audio:data.params.audio!==false,image,lastFrame,video})});const queued=await submit.json().catch(()=>({}));if(!submit.ok||!queued.ok||!queued.requestId)throw Error(queued.error||'没有提交出视频');paintProgress(8,'已提交，正在生成画面和声音…');const deadline=Date.now()+8*60*1000;while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,3000));const res=await fetch('/api/pianchang-video?id='+encodeURIComponent(queued.requestId),{credentials:'same-origin'});const job=await res.json().catch(()=>({}));if(!res.ok||job.ok===false)throw Error(job.error||'视频查询失败');if(job.status==='failed')throw Error(job.error||'出视频失败');if(job.status==='done'&&(job.dataUrl||job.url)){clearInterval(timer);paintProgress(100,'视频已生成');const made={id:C.uid(),name:(data.name||'生成视频')+'.mp4',kind:'video',type:'视频',src:job.dataUrl||job.url,created:Date.now(),locked:false,tags:'生成',description:String(data.prompt||'').slice(0,500),metadata:{from:'video-page',projectId:P?.id||'',projectName:P?.title||''}};change(()=>P.assets.push(made));rememberCatalog(made,null);setTimeout(()=>{close();toast('视频已生成，到资产中心打开')},500);return}}throw Error('视频还在生成，请过几分钟再点一次')}catch(e){clearInterval(timer);close();toast(e.message||'出视频失败')}finally{clearInterval(timer);uiBusy=false}};",
        new: "actions['video-generate']=async e=>{if(page==='canvas'){const n=node(actNodeId(e));if(!n||n.type!=='video')return toast('请先选中视频节点');return runVideoNode(n)}if(uiBusy)return;let data;try{data=videoTaskData()}catch(err){return toast(err.message)}const checked=$$('.video-ref:checked').map(el=>el.value);const plan=planVideoPageSubmit({method:data.params.method,checkedIds:checked,assets:P.assets||[],firstId:data.params.firstFrame||'',lastId:data.params.lastFrame||'',videoId:data.params.videoReference||'',galleryGet:galleryDataUrl});if(!plan.send)return toast(plan.error||'没有提交出视频');const headers=memberHeaders();let choice=null;try{const choiceReq=videoChoiceRequest(headers);const res=await fetch(choiceReq.url,{method:'GET',credentials:'same-origin',headers:choiceReq.headers});choice=await res.json();if(!res.ok)return toast('出视频方式未知，没有提交')}catch{return toast('出视频方式未知，没有提交')}const gate=providerAllowsEnqueue(choice);if(!gate.send)return toast(gate.error||'这个出图方式暂不可用');const spoken=voicedVideoPrompt();const raw=String(P.settings.videoPrompt||'');const extra=raw&&data.prompt.startsWith(raw)?data.prompt.slice(raw.length).trim():'';const prompt=[spoken,extra].filter(Boolean).join('\\n\\n');const paintProgress=(percent,label)=>{const bar=document.querySelector('#videoProgressBar'),text=document.querySelector('#videoProgressText'),pct=document.querySelector('#videoProgressPct');if(bar)bar.style.width=Math.max(0,Math.min(100,percent))+'%';if(text)text.textContent=label;if(pct)pct.textContent=Math.round(Math.max(0,Math.min(100,percent)))+'%'};uiBusy=true;const started=Date.now(),expect=Math.max(28000,Math.max(1,Math.min(15,Number(data.params.duration)||5))*7000);openModal(`<h2>正在生成视频</h2><p id=\"videoProgressText\">正在提交画面和声音…</p><div style=\"height:10px;border-radius:999px;background:#2a241c;overflow:hidden;margin:14px 0 8px\"><div id=\"videoProgressBar\" style=\"height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#c9a36a,#f3e2c2)\"></div></div><p id=\"videoProgressPct\" style=\"font-variant-numeric:tabular-nums\">0%</p><p class=\"muted\">请留在这一页。生成完成后视频会出现在资产中心。</p>`);const timer=setInterval(()=>{const ratio=Math.min(.92,(Date.now()-started)/expect);paintProgress(ratio*100,Date.now()-started<2500?'正在提交画面和声音…':'正在生成画面和声音…')},200);try{const req=videoSubmitRequest({prompt,aspect:data.params.ratio,duration:data.params.duration,resolution:data.params.resolution,audio:data.params.audio!==false,image:plan.image||'',lastFrame:plan.lastFrame||'',...(plan.lastFrame?{last_frame:plan.lastFrame}:{}),...(plan.referenceImages&&plan.referenceImages.length?{reference_images:plan.referenceImages}:{}),video:plan.video||''},headers);const submit=await fetch(req.url,{method:'POST',credentials:'same-origin',headers:req.headers,body:JSON.stringify(req.body)});const queued=await submit.json().catch(()=>({}));const accepted=acceptQueuedJob(queued,submit.ok);if(!accepted.ok)throw Error(accepted.error||'没有提交出视频');paintProgress(8,'已提交，正在生成画面和声音…');const deadline=Date.now()+8*60*1000;while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,3000));const poll=videoPollRequest(accepted.jobId,headers);const res=await fetch(poll.url,{method:'GET',credentials:'same-origin',headers:poll.headers});const job=await res.json().catch(()=>({}));const decision=pagePollDecision(job);if(!decision.terminal)continue;if(!decision.ok)throw Error(decision.error||'出视频失败');clearInterval(timer);paintProgress(100,'视频已生成');const made={id:C.uid(),name:(data.name||'生成视频')+'.mp4',kind:'video',type:'视频',src:decision.artifact,created:Date.now(),locked:false,tags:'生成',description:String(data.prompt||'').slice(0,500),metadata:{from:'video-page',projectId:P?.id||'',projectName:P?.title||''}};change(()=>P.assets.push(made));rememberCatalog(made,null);setTimeout(()=>{close();toast('视频已生成，到资产中心打开')},500);return}throw Error('视频还在生成，请过几分钟再点一次')}catch(err){clearInterval(timer);close();toast(err.message||'出视频失败')}finally{clearInterval(timer);uiBusy=false}};",
      },
    ],
  },
  {
    dest: "src/lib/image-provider.server.ts",
    before: "cc06e615a7d98fd1fad82b229608df4c16173c27e395cd8bb8f3a7c92402dd21",
    after: "aa6c495d28a515bd67deeb4d28c98e4c75aaf2afe66b51ca14a470070b202d26",
    steps: [
      {
        old: "import { canvasPayload, queueRefusal } from \"../../deploy/lib/member-queue.mjs\";\n",
        new: "import { canvasPayload, queueRefusal } from \"../../deploy/lib/member-queue.mjs\";\nimport { memberFromRequest } from \"@/lib/bench-members.server\";\nimport { jobAccessDecision, stampMemberPayload } from \"@/lib/media-route-guard\";\n",
      },
      {
        old: `/** 建一条会员出图/出视频任务。成员传来的 provider 丢掉。表或入队函数不在就不提交。 */
export async function submitMemberJob(body: unknown, kind: "image" | "video") {
  const record = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  delete record.provider;
  const chosen = await imageChoice(kind);
  const packed = canvasPayload({ ...record, kind }, chosen.id);
  const via = { id: chosen.id, name: chosen.name };`,
        new: `export async function memberViewer(request: Request) {
  try {
    const admin = await ownerOf(request);
    if (admin?.id) return { id: String(admin.id), phone: "", staff: true };
    const member = await memberFromRequest(request);
    if (!member?.id) return null;
    return { id: member.id, phone: member.phone, staff: false };
  } catch {
    return null;
  }
}

/** 建一条会员出图/出视频任务。成员传来的 provider 丢掉。表或入队函数不在就不提交。 */
export async function submitMemberJob(body: unknown, kind: "image" | "video", viewer?: { id?: string; phone?: string; staff?: boolean } | null) {
  const record = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  delete record.provider;
  const prompt = String(record.prompt || "").trim();
  if (!prompt) return { status: 400, ok: false, error: "没有画面要求", queued: false };
  const chosen = await imageChoice(kind);
  const packed = canvasPayload({ ...record, kind }, chosen.id);
  stampMemberPayload(packed, viewer || null);
  const via = { id: chosen.id, name: chosen.name };`,
      },
      {
        old: `export async function readMemberJob(id: string, request: Request, kind: "image" | "video") {
  const missing = kind === "video" ? "出视频队列还没有准备好，没有提交" : "出图队列还没有准备好，没有提交";
  const gate = await memberQueueGate(kind);`,
        new: `export async function readMemberJob(id: string, request: Request, kind: "image" | "video") {
  const wanted = String(id || "").trim();
  if (!wanted) return { http: 400, body: { ok: false, error: "没有这条任务", queued: false } };
  const missing = kind === "video" ? "出视频队列还没有准备好，没有提交" : "出图队列还没有准备好，没有提交";
  const gate = await memberQueueGate(kind);`,
      },
      {
        old: `  if (!ready.jobs) return { http: 503, body: { ok: false, error: missing, queued: false } };
  const wanted = String(id || "").trim();
  if (!wanted) return { http: 400, body: { ok: false, error: "没有这条任务", queued: false } };
  const pg = await getPglite();`,
        new: `  if (!ready.jobs) return { http: 503, body: { ok: false, error: missing, queued: false } };
  const pg = await getPglite();`,
      },
      {
        old: `  if (!row || typeof row !== "object") return { http: 404, body: { ok: false, error: "没有这条任务", queued: false } };
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};`,
        new: `  if (!row || typeof row !== "object") return { http: 404, body: { ok: false, error: "没有这条任务", queued: false } };
  const access = jobAccessDecision(row, await memberViewer(request));
  if (access) return access;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};`,
      },
    ],
  },
  {
    dest: "src/lib/bench-vault.server.ts",
    before: "2601638897407f8fe73e9ad4faddabf88df54f14000ba9b4282ccaaf2a8cd4fb",
    after: "094388a7c9426670b0bf7e181533059788f6103be40bae5994e78a641ea12348",
    steps: [
      {
        old: "import { packForCloud, isUntouchedSeed } from \"../../public/bench/project-pack.mjs\";\n",
        new: "import { packForCloud, isUntouchedSeed } from \"../../public/bench/project-pack.mjs\";\nimport { vaultWriteDecision } from \"@/lib/bench-vault-guard\";\n",
      },
      {
        old: `  const sql = await getSql();
  await ensureVault(sql);
  await sql\``,
        new: `  const sql = await getSql();
  await ensureVault(sql);
  const existing = await sql<{ scope: string }>\`select scope from bench_vault where id = \${id}\`;
  const blocked = vaultWriteDecision(existing[0]?.scope, scope);
  if (blocked) return blocked;
  await sql\``,
      },
    ],
  },
];

export const copies = [
  { dest: "public/bench/custom-text-lane.mjs", src: "modules/public/bench/custom-text-lane.mjs" },
  { dest: "public/bench/guest-adopt-guard.mjs", src: "modules/public/bench/guest-adopt-guard.mjs" },
  { dest: "public/bench/provider-block.mjs", src: "modules/public/bench/provider-block.mjs" },
  { dest: "public/bench/cloud-conflict.mjs", src: "modules/public/bench/cloud-conflict.mjs" },
  { dest: "public/bench/video-page-refs.mjs", src: "modules/public/bench/video-page-refs.mjs" },
  { dest: "src/lib/workbench-text-guard.ts", src: "modules/src/lib/workbench-text-guard.ts" },
  { dest: "src/lib/media-route-guard.ts", src: "modules/src/lib/media-route-guard.ts" },
  { dest: "src/lib/bench-vault-guard.ts", src: "modules/src/lib/bench-vault-guard.ts" },
  { dest: "public/bench/project-selection.mjs", src: "modules/public/bench/project-selection.mjs", before: "56effda9ff617bf08b990684e1fad654d590046faf00e9e33fbd0d982cbdbd20" },
  { dest: "src/routes/api/generation.ts", src: "modules/src/routes/api/generation.ts", before: "127f8ef80a7f2e7599cfd1594057fb059fae2a21b2df5fec62342072b45b0f96" },
  { dest: "src/routes/api/images.ts", src: "modules/src/routes/api/images.ts", before: "c27544aa85bcf4f4ea6b6c395f184561dbf319785d167319cb9481de1dd1d091" },
  { dest: "src/routes/api/pianchang-still.ts", src: "modules/src/routes/api/pianchang-still.ts", before: "9317766ea1f1fcf321e503a0564e6179e1616ab58a58b9f1d07ac9c41bea1e0a" },
  { dest: "src/routes/api/pianchang-video.ts", src: "modules/src/routes/api/pianchang-video.ts", before: "f30e193e2af04f77af5ef240dc8cfba60cdf447529bf61e7ece5eac999d06bab" },
];
