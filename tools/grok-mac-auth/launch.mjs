import fs from 'node:fs/promises';
import path from 'node:path';

// Labels only. Connection files also hold worker tokens; never return or log those.
const CONNECTION_NAME=/^[a-f0-9-]{36}\.json$/i;
const FORMAT='jbp-mac-text-worker-v1';
const MAX_LABEL=60;
const MAX_CONNECTION_BYTES=16384;

function usableLabel(value){
  if(typeof value!=='string')return '';
  const label=value.trim();
  if(!label||label.length>MAX_LABEL||/[\r\n\0]/.test(label))return '';
  return label;
}

export async function listImportedLabels(root){
  const directory=path.join(root,'connections');
  const names=await fs.readdir(directory).catch(()=>[]);
  const labels=[];
  for(const name of names){
    if(!CONNECTION_NAME.test(name))continue;
    const file=path.join(directory,name);
    try{
      const info=await fs.lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CONNECTION_BYTES||info.size<=0)continue;
      const raw=JSON.parse(await fs.readFile(file,'utf8'));
      if(!raw||raw.format!==FORMAT)continue;
      const label=usableLabel(raw.localLabel)||usableLabel(raw.grokLabel);
      if(label&&!labels.includes(label))labels.push(label);
    }catch{/* skip unreadable config; do not print file contents */}
  }
  labels.sort((a,b)=>a.localeCompare(b,'zh'));
  return labels;
}

export function option7Plan(imported){
  const labels=Array.isArray(imported)?imported.filter(label=>usableLabel(label)===label):[];
  if(!labels.length)return {prompt:true,labels:[]};
  return {prompt:false,labels};
}

export function resolveSingleChoice(input,imported,previous){
  const labels=Array.isArray(imported)?imported.filter(label=>usableLabel(label)===label):[];
  const answer=String(input??'').trim();
  const last=usableLabel(previous);
  if(!answer){
    if(last==='全部')return {labels:labels.slice()};
    if(last)return {labels:[last]};
    return {error:'还没有上次的选择，请输入序号或账户标识。'};
  }
  if(answer==='a'||answer==='A'||answer==='全部')return {labels:labels.slice(),saved:'全部'};
  if(/^[0-9]+$/.test(answer)){
    const n=Number(answer);
    if(!Number.isSafeInteger(n)||n<1||n>labels.length)return {error:'没有这个序号。'};
    return {labels:[labels[n-1]],saved:labels[n-1]};
  }
  const manual=usableLabel(answer);
  if(!manual)return {error:'账户标识需要1–60个字符。'};
  return {labels:[manual],saved:manual};
}

export async function readLastLabel(root){
  const text=await fs.readFile(path.join(root,'last-label.txt'),'utf8').catch(()=>'');
  return usableLabel(String(text).split(/\r?\n/,1)[0]);
}

export async function writeLastLabel(root,label){
  const value=usableLabel(label);
  if(!value)return;
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const file=path.join(root,'last-label.txt');
  await fs.writeFile(file,value+'\n',{mode:0o600});
  await fs.chmod(file,0o600);
}
