// Keep routing and credentials out of member-facing requests and shared projects.
const privateKey=/^(provider|expectedAccount|grokAccount(?:Id)?|grok_label|grok_account_id|workerToken|lease|lease_hash|token_hash|apiKey|api_key)$/i;
const providerText=/\bgrok\b|x\.ai|\bxai\b/i;
export function memberError(value){return providerText.test(String(value||''))?'模型服务暂不可用，请联系管理员':String(value||'');}
export function publicData(value){
 if(Array.isArray(value))return value.map(publicData);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey.test(key)).map(([key,item])=>[key,key==='error'?memberError(item):publicData(item)]));
}
export function providerUrl(value){try{return /(^|\.)(grok\.(com|me)|x\.ai)$/.test(new URL(value).hostname)}catch{return false}}
