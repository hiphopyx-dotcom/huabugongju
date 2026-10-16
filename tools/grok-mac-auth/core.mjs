import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function profileId(label){label=String(label||'').trim();if(!label||label.length>60||/[\r\n\0]/.test(label))throw Error('账户标识需要1–60个字符，请与管理员账户池中的标识一致');return createHash('sha256').update(label).digest('hex')}
async function privateDirectory(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});if((await fs.lstat(dir)).isSymbolicLink())throw Error('账户目录不能是符号链接');await fs.chmod(dir,0o700)}
export async function prepareProfile(root,label){const id=profileId(label),home=path.join(root,'profiles',id),cwd=path.join(root,'work',id);await privateDirectory(root);for(const parent of ['profiles','work'])await privateDirectory(path.join(root,parent));await privateDirectory(home);await privateDirectory(cwd);return {id,label:label.trim(),home,cwd}}
export function childEnvironment(home,source=process.env){const env={};for(const key of ['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','TERM','COLORTERM','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY'])if(source[key])env[key]=source[key];env.GROK_HOME=home;env.GROK_MEMORY='0';env.GROK_SUBAGENTS='0';env.GROK_WORKFLOWS='0';return env}
export const testArgs=['--tools','','--disable-web-search','--no-subagents','--no-plan','--max-turns','1','--output-format','plain','-p','这是连接测试。不要使用任何工具。请只输出：JBP_MAC_TEXT_OK'];
export function textTestStatus(code,output){if(code!==0)return '文字测试失败';return String(output).trim()==='JBP_MAC_TEXT_OK'?'文字生成验证通过':'未确认文字生成成功'}
export function safeReport(records){return {format:'jbp-local-auth-diagnostic-v1',generated:new Date().toISOString(),websiteConnected:false,scope:'local-text-check-only',accounts:records.map(record=>({label:String(record.label||''),state:String(record.state||'未知'),updated:String(record.updated||'')}))}}
