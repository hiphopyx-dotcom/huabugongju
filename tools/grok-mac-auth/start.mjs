import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {prepareProfile,childEnvironment,testArgs} from './core.mjs';
process.umask(0o077);
const root=path.join(os.homedir(),'Library','Application Support','JubaopengGrokAuth');
const runtime=path.join(root,'runtime'),binary=path.join(runtime,'node_modules','.bin','grok');
const rl=createInterface({input:process.stdin,output:process.stdout});
function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',shell:false,...options});child.on('error',reject);child.on('exit',(code,signal)=>resolve(code??(signal?130:1)))})}
async function install(){try{await fs.access(binary);return}catch{}console.log('\n首次安装官方 Grok Build 1.0.60（需要联网，不会购买会员）。');const answer=await rl.question('安装到本机独立目录？输入 y 继续：');if(answer.trim().toLowerCase()!=='y')throw Error('未安装，已退出');await fs.mkdir(runtime,{recursive:true,mode:0o700});const code=await run('npm',['install','--prefix',runtime,'--no-audit','--no-fund','@xai-official/grok@1.0.60']);if(code)throw Error('安装未成功，请检查网络和 Node.js/npm')}
async function save(profile,state){const file=path.join(profile.home,'jbp-status.json');await fs.writeFile(file,JSON.stringify({label:profile.label,state,updated:new Date().toISOString()},null,2),{mode:0o600})}
async function status(){const base=path.join(root,'profiles');const ids=await fs.readdir(base).catch(()=>[]);if(!ids.length)console.log('尚未创建本机账户。');for(const id of ids){if(!/^[a-f0-9]{64}$/.test(id))continue;const s=await fs.readFile(path.join(base,id,'jbp-status.json'),'utf8').then(JSON.parse).catch(()=>null);if(s)console.log(`${s.label} · ${s.state} · ${s.updated}`)}console.log('这些是本机记录，不代表当前登录仍有效，也没有同步到网站。')}
async function action(choice){const label=(await rl.question('输入与管理员账户池一致的账户标识（邮箱或名称）：')).trim();const p=await prepareProfile(root,label);const env=childEnvironment(p.home);await install();await fs.writeFile(path.join(p.home,'config.toml'),'[cli]\nauto_update = false\n',{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});
if(choice==='1'||choice==='2'){console.log('\n请在官方页面核对要登录的账户；若浏览器选错账户，请先切换。密码只在官方页面输入。\n本机标识不能替代身份核验，工具不会读取你的密码或令牌。');const code=await run(binary,['login',choice==='2'?'--device-auth':'--oauth'],{cwd:p.cwd,env});if(code){await save(p,'授权未完成');console.log('授权未完成，未标记为可调用。');return}const present=await fs.stat(path.join(p.home,'auth.json')).then(s=>s.isFile()&&s.size>0).catch(()=>false);await save(p,present?'官方登录结束，待文字测试':'登录命令结束，未确认凭据文件');console.log('登录流程已结束。请执行菜单 3 测试文字权限；尚未连接工作台。');return}
console.log('\n下面执行一次固定文字测试，不开放文件或命令工具。只有看到 JBP_MAC_TEXT_OK 才能确认本次文字测试成功。');const code=await run(binary,testArgs,{cwd:p.cwd,env});await save(p,code===0?'文字测试命令完成，请核对返回内容':'文字测试失败');console.log('\n网站成员调用尚未接入；此工具不验证图片、视频权限。')}
console.log('剧爆棚 · Mac 本机 Grok 授权验证工具\n仅验证官方 Grok Build 登录和文字能力；不会把本机授权自动接入网站。');
try{if(process.platform!=='darwin')throw Error('请在你的 Mac mini 上运行此工具');for(;;){console.log('\n1 浏览器授权账户\n2 设备码授权（浏览器方式不顺利时）\n3 验证账户文字生成\n4 查看本机记录\n0 退出');const choice=(await rl.question('请选择：')).trim();if(choice==='0')break;try{if(choice==='4')await status();else if(['1','2','3'].includes(choice))await action(choice);else console.log('请输入0–4')}catch(e){console.log('未完成：'+e.message)}}}catch(e){console.error(e.message);process.exitCode=1}finally{rl.close()}
