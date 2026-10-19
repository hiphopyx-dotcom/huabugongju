import fs from 'node:fs/promises';
import path from 'node:path';

// Inspect only local identity metadata. Never return, log or upload credentials.
export async function verifyIdentity(profile,expectedLabel){
 let auth;try{auth=JSON.parse(await fs.readFile(path.join(profile.home,'auth.json'),'utf8'))}catch{throw Error('无法核对本机登录身份，请重新授权')}
 const identity=auth['https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'];
 if(!identity||typeof identity.email!=='string'||typeof identity.user_id!=='string')throw Error('本机登录身份缺失，请重新授权');
 const email=identity.email.trim().toLowerCase();
 for(const label of [expectedLabel,profile.label]){
  if(typeof label==='string'&&label.includes('@')&&label.trim().toLowerCase()!==email)throw Error('账户标识与本机实际登录邮箱不一致，请核对后重新授权');
 }
 return {email,userId:identity.user_id};
}
