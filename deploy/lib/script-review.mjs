import {AccountError, cookie, hash, requireAdmin, safeOrigin} from './security.mjs';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const integer=(v,min,max,fallback)=>Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):fallback;
const clip=(value,max)=>String(value??'').slice(0,max);
export function isLockedEpisode(number,description=''){
 const n=Number(number);
 return String(description).split(/[,，、;\s]+/).some(part=>{
  const m=part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
  return m?(n>=Number(m[1])&&n<=Number(m[2])):/^\d+$/.test(part)&&n===Number(part);
 });
}
export const countScriptChars=text=>(String(text).match(/[\p{L}\p{N}]/gu)||[]).length;
export function evaluateReview(report,text,threshold,minChars,maxChars){
 const score=Number(report?.score);
 const issues=Array.isArray(report?.issues)?report.issues.slice(0,30).map(x=>({severity:['critical','major','minor'].includes(x?.severity)?x.severity:'major',location:clip(x?.location,160),problem:clip(x?.problem,600),suggestion:clip(x?.suggestion,600)})):[];
 const charCount=countScriptChars(text),reasons=[];
 if(!Number.isFinite(score)||score<0||score>100)throw new AccountError(502,'Gemini 评分格式无效，请重新评审');
 if(score<threshold)reasons.push('综合评分未达到'+threshold+'分');
 if(issues.some(x=>x.severity==='critical'))reasons.push('存在严重逻辑或人物一致性问题');
 if(charCount<minChars||charCount>maxChars)reasons.push('正文计数字符 '+charCount+'，目标 '+minChars+'—'+maxChars);
 return {score,issues,summary:clip(report.summary,2400),strengths:Array.isArray(report?.strengths)?report.strengths.slice(0,8).map(x=>clip(x,300)):[],charCount,passed:reasons.length===0,reasons};
}
export function parseReview(text){
 try{return JSON.parse(text.replace(/^\\s*\x60\x60\x60(?:json)?\\s*/i,'').replace(/\\s*\x60\x60\x60\\s*$/,'').trim())}
 catch{throw new AccountError(502,'Gemini 未返回有效 JSON 评审，请重试本轮')}
}
async function responseText(response){
 if(!response.ok)throw new AccountError(502,'模型供应商响应失败（HTTP '+response.status+'），请检查密钥、模型、余额或速率限制');
 const body=await response.json().catch(()=>{throw new AccountError(502,'模型响应不是有效 JSON')});
 return body;
}
export function createScriptReviewHandler(query,config={},fetcher=fetch){
 return async function handler(req){
  try{
   safeOrigin(req);
   const q=async(sql,...params)=>query(sql,params);
   const one=async(sql,...params)=>(await q(sql,...params))[0];
   const token=cookie(req);
   const user=token?await one('SELECT a.id,a.role FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND s.version=a.session_version AND a.active=true',hash(token),Date.now()):null;
   requireAdmin(user);
   const openaiKey=config.openaiKey??process.env.OPENAI_API_KEY;
   const geminiKey=config.geminiKey??process.env.GEMINI_API_KEY;
   const openaiModel=config.openaiModel??process.env.OPENAI_MODEL??'gpt-5.1';
   const geminiModel=config.geminiModel??process.env.GEMINI_MODEL??'gemini-3.1-pro';
   if(req.method==='GET')return json({openaiConfigured:!!openaiKey,geminiConfigured:!!geminiKey,openaiModel,geminiModel});
   if(req.method!=='POST')throw new AccountError(405,'不支持此请求');
   const raw=await req.text();
   if(raw.length>70000)throw new AccountError(413,'请求过大；请只送审当前一集及必要的故事资料');
   let b;try{b=JSON.parse(raw)}catch{throw new AccountError(400,'请求 JSON 无效')}
   const stage=b.stage;
   if(!['draft','review','revise'].includes(stage))throw new AccountError(400,'未知执行阶段');
   const episodeNo=integer(b.episodeNo,1,200,0);
   if(!episodeNo)throw new AccountError(400,'集数无效');
   if(isLockedEpisode(episodeNo,b.lockedEpisodes))throw new AccountError(409,'该集已封板，禁止自动生成、送审或修改');
   const minChars=integer(b.minChars,100,8000,episodeNo===1?1000:700);
   const maxChars=integer(b.maxChars,minChars,12000,episodeNo===1?1500:1000);
   const threshold=integer(b.threshold,60,100,95);
   const title=clip(b.title,120);
   const context=clip(b.context,16000);
   const rubric=clip(b.rubric,5500);
   const text=clip(b.text,14500);
   const feedback=clip(JSON.stringify(b.feedback||{}),11500);
   if(stage!=='draft'&&text.trim().length<20)throw new AccountError(400,'请先提供当前集的完整正文');
   if(stage==='revise'&&feedback.length<30)throw new AccountError(400,'缺少 Gemini 评审意见');
   if((stage==='review'&&!geminiKey)||(stage!=='review'&&!openaiKey))throw new AccountError(503,'尚未配置 '+(stage==='review'?'GEMINI_API_KEY':'OPENAI_API_KEY'));
   const now=Date.now(),rateKey=hash('jbp-script-ai:'+user.id);
   const limiter=await one('INSERT INTO studio_login_limits (key,attempts,until_ms) VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN studio_login_limits.until_ms<$3 THEN 1 ELSE studio_login_limits.attempts+1 END,until_ms=CASE WHEN studio_login_limits.until_ms<$3 THEN $2 ELSE studio_login_limits.until_ms END RETURNING attempts',rateKey,now+3600000,now);
   if(limiter.attempts>30)throw new AccountError(429,'每小时最多请求30次模型，请稍后再试');
   const common='项目：'+title+'；第'+episodeNo+'集；目标计数字符：'+minChars+'—'+maxChars+'。\\n创作母版与前后集事实（仅供参考，不得擅自改动）：\\n'+context+'\\n验收标准：\\n'+rubric+'\\n注意：封板内容不可改写；只能输出本集正文；不编造前集因果；台词、动作、场次规范；故事动作连贯，冲突密集，结尾有戏剧性悬念。';
   if(stage==='review'){
    const system='你是独立的短剧总编审，严格、可验证地按剧本事实评估。只输出符合格式的 JSON，不包含 Markdown。分数0至100。critical表示严重剧情断裂、因果矛盾、人物背离或封板冲突；major表示显著节奏/钩子/信息缺失；minor表示格式和语言问题。必须指明具体位置和可实施建议。';
    const prompt=common+'\\n待审正文：\\n'+text+'\\n返回 JSON：{"score":95,"summary":"...","strengths":["..."],"issues":[{"severity":"critical|major|minor","location":"第几场或台词","problem":"问题","suggestion":"建议"}]}';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
    try{
     const r=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(geminiModel)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':geminiKey},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:3500}}),signal:controller.signal});
     const body=await responseText(r);
     const output=(body.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('');
     if(!output)throw new AccountError(502,'Gemini 未返回评审文本');
     return json({stage,model:geminiModel,review:evaluateReview(parseReview(output),text,threshold,minChars,maxChars)});
    }finally{clearTimeout(timer)}
   }
   const system='你是中国商业短剧职业编剧，遵循已锁母版、人物逻辑和逐场剧本格式。只输出当前一集的完整可拍摄正文，不输出解释、评分或编辑标签。不得省略必要场景和动作。避免同质化重复桥段。';
   const prompt=stage==='draft'?common+'\\n用户提供的当前草稿或剧情指令（可以为空）：\\n'+text+'\\n请完成这一集完整剧本。':common+'\\n当前一集原稿：\\n'+text+'\\nGemini 逐条评审反馈：\\n'+feedback+'\\n只精准修订本集，优先修复有证据的问题；不能因为追求分数破坏原有已锁定的剧情和台词，不得更动其他集。';
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
   try{
    const r=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+openaiKey,'Content-Type':'application/json'},body:JSON.stringify({model:openaiModel,store:false,instructions:system,input:prompt,max_output_tokens:6500}),signal:controller.signal});
    const body=await responseText(r);
    if(body.status==='incomplete')throw new AccountError(502,'OpenAI 正文超出输出长度限制，请缩小本集任务');
    const output=body.output_text||body.output?.flatMap(x=>(x.content||[]).filter(c=>c.type==='output_text').map(c=>c.text)).join('')||'';
    if(!output.trim())throw new AccountError(502,'OpenAI 没有返回有效剧本正文');
    return json({stage,model:openaiModel,text:output.trim(),charCount:countScriptChars(output)});
   }finally{clearTimeout(timer)}
  }catch(e){
   if(e.name==='AbortError')return json({error:'模型响应超时，本轮已停止；此前版本已保留'},504);
   if(!e.status)console.error('script-review',e.name||'unknown');
   return json({error:e.status?e.message:'审稿服务暂不可用，请稍后重试'},e.status||503);
  }
 }
}
