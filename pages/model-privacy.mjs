// Keep routing and credentials out of member-facing requests and shared projects.
const privateKey=/^(provider|expectedAccount|grokAccount(?:Id)?|grok_label|grok_account_id|workerToken|lease|lease_hash|token_hash|apiKey|api_key)$/i;
const providerText=/\bgrok\b|x\.ai|\bxai\b/i;
// Fixed Chinese reasons written by the Mac image worker (deploy/lib/image-worker.mjs FAILURE_REASONS); shown as-is.
export const WORKER_MESSAGES=Object.freeze(['Mac 上的 Grok 会员账号未登录或登录已过期，请在 Mac 上重新登录 grok.com 后再出图','grok.com 要求人机验证，请在 Mac 上手动完成验证后再出图','Grok 会员生图额度已用完，请等额度恢复后再出图','提示词或图片被 Grok 拒绝生成，请修改提示词后重试','Grok 页面超时未出图，未重复提交；请稍后重试','Mac 上登录的 Grok 账号与配置不一致，已停止出图','Mac 上该 Grok 浏览器窗口正被占用，请关闭后再出图','Grok 页面提交失败，请重试','Grok 页面异常，未能完成出图，请重试；多次失败请联系管理员','Grok 页面结构异常，未能完成出图；请联系管理员']);
export function memberError(value){const text=String(value||'');return WORKER_MESSAGES.includes(text)?text:providerText.test(text)?'模型服务暂不可用，请联系管理员':text;}
export function publicData(value){
 if(Array.isArray(value))return value.map(publicData);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey.test(key)).map(([key,item])=>[key,key==='error'?memberError(item):publicData(item)]));
}
export function providerUrl(value){try{return /(^|\.)(grok\.(com|me)|x\.ai)$/.test(new URL(value).hostname)}catch{return false}}
