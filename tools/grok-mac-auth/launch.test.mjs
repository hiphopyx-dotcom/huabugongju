import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listImportedLabels,option7Plan,resolveSingleChoice,readLastLabel,writeLastLabel} from './launch.mjs';

const TOKEN='tok_LEAKED_WORKER_TOKEN_VALUE_DO_NOT_PRINT';

function connection(label,extra={}){
  return {format:'jbp-mac-text-worker-v1',origin:'https://jubaopeng-canvas.vercel.app',grokAccountId:extra.grokAccountId,grokLabel:extra.grokLabel??label,workerToken:TOKEN,localLabel:extra.localLabel,...extra.rest};
}

async function tempRoot(){
  return fs.mkdtemp(path.join(os.tmpdir(),'jbp-launch-'));
}

test('已导入连接按本机标识列出，早期文件退回网站标识，且不带出令牌',async()=>{
  const root=await tempRoot();
  const logs=[];
  const original=console.log;
  console.log=(...args)=>logs.push(args.join(' '));
  try{
    const directory=path.join(root,'connections');
    await fs.mkdir(directory);
    const files=[
      ['22222222-2222-4222-8222-222222222222',connection('hiphopyxa@gmail.com',{localLabel:'hiphopyxa@gmail.com',grokLabel:'网站甲'})],
      ['11111111-1111-4111-8111-111111111111',connection('hiphopyx@gmail.com',{localLabel:'hiphopyx@gmail.com',grokLabel:'网站乙'})],
      ['44444444-4444-4444-8444-444444444444',connection('lixin@example.com',{localLabel:'',grokLabel:'lixin@example.com'})],
      ['33333333-3333-4333-8333-333333333333',connection('hiphopyxb@gmail.com',{localLabel:'hiphopyxb@gmail.com'})],
      ['55555555-5555-4555-8555-555555555555',connection('hiphopyx@gmail.com',{localLabel:'hiphopyx@gmail.com',grokLabel:'重复'})]
    ];
    for(const [id,body] of files)await fs.writeFile(path.join(directory,id+'.json'),JSON.stringify({...body,workerToken:TOKEN}));
    await fs.writeFile(path.join(directory,'notes.json'),JSON.stringify({format:'jbp-mac-text-worker-v1',grokLabel:'不该出现',workerToken:TOKEN}));
    await fs.writeFile(path.join(directory,'66666666-6666-4666-8666-666666666666.json'),JSON.stringify({format:'other',grokLabel:'别的格式',workerToken:TOKEN}));
    await fs.writeFile(path.join(directory,'77777777-7777-4777-8777-777777777777.json'),'{not json '+TOKEN);
    const labels=await listImportedLabels(root);
    assert.deepEqual(labels,['hiphopyx@gmail.com','hiphopyxa@gmail.com','hiphopyxb@gmail.com','lixin@example.com']);
    const plan=option7Plan(labels);
    assert.equal(plan.prompt,false);
    assert.deepEqual(plan.labels,labels);
    assert.equal(JSON.stringify(labels).includes(TOKEN),false);
    assert.equal(logs.join('\n').includes(TOKEN),false);
    assert.deepEqual(option7Plan([]),{prompt:true,labels:[]});
    assert.deepEqual(option7Plan(await listImportedLabels(path.join(root,'missing'))),{prompt:true,labels:[]});
  }finally{console.log=original;await fs.rm(root,{recursive:true,force:true})}
});

test('单个账户可用序号、手输标识、全部或回车沿用上次，回车没有记录时不启动',()=>{
  const labels=['hiphopyx@gmail.com','hiphopyxa@gmail.com','hiphopyxb@gmail.com','lixin@example.com'];
  assert.deepEqual(resolveSingleChoice('2',labels,''),{labels:['hiphopyxa@gmail.com'],saved:'hiphopyxa@gmail.com'});
  assert.deepEqual(resolveSingleChoice('全部',labels,''),{labels,saved:'全部'});
  assert.deepEqual(resolveSingleChoice('a',labels,'').labels,labels);
  assert.deepEqual(resolveSingleChoice('other@example.com',labels,''),{labels:['other@example.com'],saved:'other@example.com'});
  assert.deepEqual(resolveSingleChoice('',labels,'hiphopyxb@gmail.com'),{labels:['hiphopyxb@gmail.com']});
  assert.deepEqual(resolveSingleChoice('',labels,'全部'),{labels});
  assert.equal(resolveSingleChoice('',labels,'').error,'还没有上次的选择，请输入序号或账户标识。');
  assert.equal(resolveSingleChoice('9',labels,'').error,'没有这个序号。');
  assert.equal(resolveSingleChoice('x'.repeat(61),labels,'').error,'账户标识需要1–60个字符。');
  assert.equal(JSON.stringify(resolveSingleChoice('1',labels,TOKEN)).includes(TOKEN),false);
});

test('上次选择写在本机目录，不含连接令牌',async()=>{
  const root=await tempRoot();
  try{
    await writeLastLabel(root,'hiphopyx@gmail.com');
    assert.equal(await readLastLabel(root),'hiphopyx@gmail.com');
    const file=path.join(root,'last-label.txt');
    assert.equal((await fs.stat(file)).mode&0o777,0o600);
    await writeLastLabel(root,'坏标识\n'+TOKEN);
    await writeLastLabel(root,'x'.repeat(61));
    assert.equal(await readLastLabel(root),'hiphopyx@gmail.com');
    assert.equal((await fs.readFile(file,'utf8')).includes(TOKEN),false);
    await writeLastLabel(root,'全部');
    assert.equal(await readLastLabel(root),'全部');
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
