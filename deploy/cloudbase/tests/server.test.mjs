import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createStudioApp,createNodeServer} from '../server.mjs';

const origin='https://example.invalid';
test('HTTP bridge preserves trusted origin, query, binary bytes, redirects and individual cookies',async t=>{
  let seen;
  const server=createNodeServer(async req=>{
    seen={url:req.url,origin:req.headers.get('origin'),cookie:req.headers.get('cookie'),body:await req.text()};
    const headers=new Headers({'Content-Type':'image/png','Location':'/next'});
    headers.append('Set-Cookie','__Host-jbp-session=a; Path=/; HttpOnly; Secure; SameSite=Strict');
    headers.append('Set-Cookie','second=b; Path=/; Secure');
    return new Response(new Uint8Array([0,255,13,10,128]),{status:201,headers});
  },origin);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/images?action=import',method:'POST',
      headers:{Host:'attacker.invalid',Origin:origin,Cookie:'__Host-jbp-session=local-test'}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));
    });
    req.on('error',reject);req.end('hello');
  });
  assert.equal(seen.url,origin+'/api/images?action=import');assert.equal(seen.origin,origin);
  assert.equal(seen.cookie,'__Host-jbp-session=local-test');assert.equal(seen.body,'hello');
  assert.equal(result.status,201);assert.equal(result.headers.location,'/next');
  assert.equal(result.headers['set-cookie'].length,2);assert.deepEqual([...result.body],[0,255,13,10,128]);
});

test('static manifest serves Chinese paths and HEAD, while excluding source, dotfiles and unknown APIs',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-static-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'shot-reference'));
  await fs.mkdir(path.join(dir,'studio'));
  await fs.writeFile(path.join(dir,'index.html'),'workbench');
  await fs.writeFile(path.join(dir,'shot-reference/电影叙事.jpg'),new Uint8Array([1,255,2]));
  await fs.writeFile(path.join(dir,'studio/core.mjs'),'private');
  await fs.writeFile(path.join(dir,'release.json'),JSON.stringify({contentHash:'test'}));
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(['index.html','shot-reference/电影叙事.jpg','studio/core.mjs','../secret','.env']));
  const app=await createStudioApp({publicDir:dir,apiHandler:()=>Response.json({error:'接口不存在'},{status:404})});
  const request=(url,method='GET')=>app(new Request(origin+url,{method}));
  assert.equal(await(await request('/')).text(),'workbench');
  const image=await request('/shot-reference/'+encodeURIComponent('电影叙事')+'.jpg');
  assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual([...new Uint8Array(await image.arrayBuffer())],[1,255,2]);
  assert.equal(await(await request('/','HEAD')).text(),'');
  for(const url of ['/studio/core.mjs','/.env','/server.mjs','/%2e%2e%2fsecret']) assert.equal((await request(url)).status,404);
  assert.equal((await request('/api/missing')).headers.get('content-type'),'application/json');
  assert.deepEqual((await(await request('/healthz')).json()).release,{contentHash:'test'});
});
