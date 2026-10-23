import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {importConnection,startWorker} from './worker.mjs';
import {checkConnection} from './preflight.mjs';
import {createInterface} from 'node:readline/promises';
import {prepareProfile,childEnvironment,testArgs,textTestStatus,safeReport} from './core.mjs';
process.umask(0o077);
const root=path.join(os.homedir(),'Library','Application Support','JubaopengGrokAuth');
const runtime=path.join(root,'runtime'),binary=path.join(runtime,'node_modules','.bin','grok');
const rl=createInterface({input:process.stdin,output:process.stdout});
function run(command,args,options={},capture=false){return new Promise((resolve,reject)=>{let output='',overflow=false;const child=spawn(command,args,{stdio:capture?['ignore','pipe','inherit']:'inherit',shell:false,...options});if(capture)child.stdout.on('data',chunk=>{if(output.length+chunk.length>1048576){overflow=true;child.kill();return}output+=chunk.toString()});child.on('error',reject);child.on('close',(code,signal)=>{const exit=overflow?1:code??(signal?130:1);resolve(capture?{code:exit,output}:exit)})})}
async function install(){try{await fs.access(binary);return}catch{}console.log('\n首次安装官方 Grok Build 1.0.60（需要联网，不会购买会员）。');const answer=await rl.question('安装到本机独立目录？输入 y 继续：');if(answer.trim().toLowerCase()!=='y')throw Error('未安装，已退出');await fs.mkdir(runtime,{recursive:true,mode:0o700});const code=await run('npm',['install','--prefix',runtime,'--no-audit','--no-fund','@xai-official/grok@1.0.60']);if(code)throw Error('安装未成功，请检查网络和 Node.js/npm')}
async function save(profile,state){const file=path.join(profile.home,'jbp-status.json');await fs.writeFile(file,JSON.stringify({label:profile.label,state,updated:new Date().toISOString()},null,2),{mode:0o600})}
async function records(){const base=path.join(root,'profiles');const ids=await fs.readdir(base).catch(()=>[]);const records=[];for(const id of ids){if(!/^[a-f0-9]{64}$/.test(id))continue;const s=await fs.readFile(path.join(base,id,'jbp-status.json'),'utf8').then(JSON.parse).catch(()=>null);if(s)records.push(s)}return records}
async function status(){const list=await records();if(!list.length)console.log('尚未创建本机账户。');for(const s of list)console.log(`${s.label} · ${s.state} · ${s.updated}`);console.log('这些是本机记录，不代表当前登录仍有效，也没有同步到网站。')}
async function report(){const destination=path.join(path.dirname(fileURLToPath(import.meta.url)),`JBP_Auth_Report_${Date.now()}.json`);await fs.writeFile(destination,JSON.stringify(safeReport(await records()),null,2),{mode:0o600,flag:'wx'});console.log('诊断报告已生成：'+destination+'\n可发送这个报告协助排查；无需发送 auth.json、密码或验证码。');}
async function preflight(){
 let file=(await rl.question('拖入已导入的连接配置 JSON 文件，再回车：')).trim();
 if((file.startsWith("'")&&file.endsWith("'"))||(file.startsWith('"')&&file.endsWith('"')))file=file.slice(1,-1);
 file=file.replace(/\\([ ()])/g,'$1');
 const result=await checkConnection(root,file);
 const names={config:'连接配置',identity:'本机身份',cli:'官方 CLI',site:'工作台首页',generationEndpoint:'生成接口'};
 const codes={CONFIG_VALID:'格式有效（未验证服务端是否撤销）',CONFIG_INVALID:'文件无效或不安全，请选择已导入的配置',IDENTITY_MATCHED:'本机身份匹配（非在线登录验证）',IDENTITY_INVALID:'身份缺失、不匹配或路径不安全',CLI_PRESENT:'已安装',CLI_MISSING:'未找到可执行的官方 CLI',REACHABLE:'可达',LOGIN_REQUIRED:'可达；未登录请求已被拒绝',HTTP_ERROR:'响应异常',NETWORK_ERROR:'连接失败或重定向已拒绝',TIMEOUT:'连接超时'};
 for(const check of result.checks)console.log(`${names[check.name]}：${codes[check.code]}`);
 console.log('检查不领取任务、不发送账号凭据、不执行生成。网站可达不等于生成可用；会员扣额来源尚未核实。');
}
async function action(choice){const label=(await rl.question('输入与管理员账户池一致的账户标识（邮箱或名称）：')).trim();const p=await prepareProfile(root,label);const env=childEnvironment(p.home);await install();await fs.writeFile(path.join(p.home,'config.toml'),'[cli]\nauto_update = false\n',{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});
if(choice==='1'||choice==='2'){console.log('\n请在官方页面核对要登录的账户；若浏览器选错账户，请先切换。密码只在官方页面输入。\n本机标识不能替代身份核验，工具不会读取你的密码或令牌。');const code=await run(binary,['login',choice==='2'?'--device-auth':'--oauth'],{cwd:p.cwd,env});if(code){await save(p,'授权未完成');console.log('授权未完成，未标记为可调用。');return}const present=await fs.stat(path.join(p.home,'auth.json')).then(s=>s.isFile()&&s.size>0).catch(()=>false);await save(p,present?'官方登录结束，待文字测试':'登录命令结束，未确认凭据文件');console.log('登录流程已结束。请执行菜单 3 测试文字权限；尚未连接工作台。');return}
console.log('\n下面执行一次固定文字测试，不开放文件或命令工具。只有看到 JBP_MAC_TEXT_OK 才能确认本次文字测试成功。');const result=await run(binary,testArgs,{cwd:p.cwd,env},true);const state=textTestStatus(result.code,result.output);await save(p,state);console.log('测试结果：'+state);if(state==='文字生成验证通过')console.log('JBP_MAC_TEXT_OK');else console.log('没有收到准确的测试返回，请核对官方账户登录及权限；未记录为通过。');await report();console.log('\n网站成员调用尚未接入；此工具不验证图片、视频权限。')}
console.log('剧爆棚 · Mac 本机 Grok 授权验证工具\n可验证官方 Grok Build 登录和文字能力；导入本站连接配置后，可领取工作台文字任务。');
try{if(process.platform!=='darwin')throw Error('请在你的 Mac mini 上运行此工具');for(;;){console.log('\n1 浏览器授权账户\n2 设备码授权（浏览器方式不顺利时）\n3 验证账户文字生成\n4 查看本机记录\n5 导出安全诊断报告\n6 导入网站连接配置\n7 启动文字工作端\n8 检查本机与站点连接（不生成）\n0 退出');const choice=(await rl.question('请选择：')).trim();if(choice==='0')break;try{if(choice==='8')await preflight();else if(choice==='4')await status();else if(choice==='5')await report();else if(choice==='6'){const filename=await rl.question('把下载的 JBP-Mac-Connection-…json 文件拖入此窗口，再回车：');const localLabel=await rl.question('已授权的本机账户标识（例如 hiphopyx@gmail.com；留空使用网站标识）：');const label=await importConnection(root,filename,localLabel);console.log(label+' 的连接配置已保存。选择7启动工作端。')}else if(choice==='7'){const controller=new AbortController(),stop=()=>controller.abort();rl.on('SIGINT',stop);try{await startWorker(root,{signal:controller.signal})}finally{rl.removeListener('SIGINT',stop)}}else if(['1','2','3'].includes(choice))await action(choice);else console.log('请输入0–8')}catch(e){console.log('未完成：'+e.message)}}}catch(e){console.error(e.message);process.exitCode=1}finally{rl.close()}
