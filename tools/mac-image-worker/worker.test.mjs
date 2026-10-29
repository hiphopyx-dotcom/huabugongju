import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {validateConfig,validateJob,validateDataUrl,checkConnection,generateImage,createReceiptStore,createJobProcessor,websiteRequest,nativeWebsiteFetch,startWorker} from './worker.mjs';

const SECRET='secret-only-at-model', TOKEN='t'.repeat(43), LEASE='l'.repeat(43);
const config={format:'jbp-mac-image-worker-v1',origin:'https://unfair-pony-d7gvmlx4ne8e8796a-1515553937.ap-shanghai.app.tcloudbase.com',workerId:'primary',workerToken:TOKEN};
const id='12345678-1234-4123-8123-123456789abc';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image='data:image/png;base64,'+png;
const job={id,lease:LEASE,prompt:'白色陶瓷杯',ratio:'1:1',resolution:'1k',references:[]};
const json=(value,status=200)=>Response.json(value,{status});
const intent={version:1,id,lease:LEASE,state:'intent',created:1,updated:1};
async function directory(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-image-worker-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
function memoryStore(initial){let receipt=initial;const writes=[];return {writes,read:async()=>receipt,pending:async()=>receipt&&['intent','result'].includes(receipt.state)?[receipt]:[],write:async item=>{writes.push(structuredClone(item));receipt=structuredClone(item);},get:()=>receipt};}

test('configuration accepts only exact website origins and expected fields',()=>{
  assert.equal(validateConfig(config),config);
  for(const change of [{origin:config.origin+'/'},{origin:'https://evil.example'},{origin:'http://jubaopeng-canvas.vercel.app'},{origin:'https://jubaopeng-canvas.vercel.app.evil.example'},{workerToken:'short'},{workerToken:[TOKEN]},{workerId:'other'},{apiKey:SECRET}]) assert.throws(()=>validateConfig({...config,...change}));
});
test('jobs reject oversized, remote, unsupported, malformed reference images and identity fields',()=>{
  assert.equal(validateDataUrl(image),image);validateJob({...job,references:[image]});
  for(const references of [['https://example.com/image.png'],['data:image/svg+xml;base64,PHN2Zz4='],['data:image/png;base64,AAAA'],Array(4).fill(image),['data:image/png;base64,'+Buffer.alloc(3*1024*1024+1).toString('base64')]]) assert.throws(()=>validateJob({...job,references}));
  assert.throws(()=>validateJob({...job,owner:'another-account'}));assert.throws(()=>validateJob({...job,prompt:'x'.repeat(8001)}));assert.throws(()=>validateJob({...job,lease:[LEASE]}));
});
test('three full-size gallery references survive the poll response boundary',async()=>{
 const bytes=Buffer.alloc(3*1024*1024);const original=Buffer.from(png,'base64');original.copy(bytes);original.subarray(-12).copy(bytes,bytes.length-12);
 const reference='data:image/png;base64,'+bytes.toString('base64'),full={...job,references:Array(3).fill(reference)};
 assert.equal(validateJob(full),full);const result=await websiteRequest(config,'poll',{}, {fetcher:async()=>Response.json({job:full})});assert.deepEqual(result.job.references,full.references);
});
test('metadata check reads status only and does not consume response body',async()=>{
  let cancelled=false;const response={status:200,body:{cancel:async()=>{cancelled=true;}},json(){throw Error('must not read');},text(){throw Error('must not read');}};
  assert.deepEqual(await checkConnection(SECRET,{fetcher:async(url,options)=>{assert.equal(url,'https://api.x.ai/v1/api-key');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+SECRET);return response;}}),{ok:true,status:200});assert.ok(cancelled);
  assert.deepEqual(await checkConnection(SECRET,{fetcher:async()=>({...response,status:201})}),{ok:false,status:201});
  assert.deepEqual(await checkConnection(SECRET,{fetcher:async()=>{throw Error(SECRET);}}),{ok:false,status:null});
});
test('provider uses one fixed POST with the required model settings and validated image result',async()=>{
  let calls=0;const result=await generateImage(job,SECRET,{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.x.ai/v1/images/generations');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+SECRET);assert.deepEqual(JSON.parse(options.body),{model:'grok-imagine-image-2.0',prompt:job.prompt,n:1,quality:'low',resolution:'1k',aspect_ratio:'1:1',response_format:'b64_json'});return json({data:[{b64_json:png}]});}});
  assert.deepEqual(result,{dataUrl:image});assert.equal(calls,1);
});
test('reference requests use the existing JSON edit API format',async()=>{
  for(const count of [1,2]) await generateImage({...job,references:Array(count).fill(image)},SECRET,{fetcher:async(url,options)=>{assert.equal(url,'https://api.x.ai/v1/images/edits');const body=JSON.parse(options.body);if(count===1)assert.deepEqual(body.image,{type:'image_url',url:image});else assert.deepEqual(body.images,Array(count).fill({type:'image_url',url:image}));return json({data:[{b64_json:png}]});}});
});
test('rejections and uncertain failures never retry or expose provider messages',async()=>{
  for(const [status,error] of [[400,'REJECTED'],[401,'REJECTED'],[429,'REJECTED'],[408,'UNCERTAIN'],[500,'UNCERTAIN']]){let count=0;const result=await generateImage(job,SECRET,{fetcher:async()=>{count++;return json({secret:SECRET},status);}});assert.deepEqual(result,{error});assert.equal(count,1);}
  for(const fetcher of [async()=>{throw Error('https://api.x.ai/'+SECRET);},async()=>json({data:[{url:'https://example.com'}]}),async()=>new Response('bad json')])assert.deepEqual(await generateImage(job,SECRET,{fetcher}),{error:'UNCERTAIN'});
});
test('website requests carry only the worker credential and no browser identity headers',async()=>{
  await websiteRequest(config,'complete',{id,lease:LEASE,dataUrl:image},{fetcher:async(url,options)=>{assert.equal(url,config.origin+'/api/image-worker?action=complete');assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.ok(!Object.keys(options.headers).some(k=>/origin|sec-fetch/i.test(k)));assert.ok(!JSON.stringify(options).includes(SECRET));return json({saved:true,status:'done'});}});
  await assert.rejects(()=>websiteRequest(config,'poll',{}, {fetcher:async()=>json({},401)}),{kind:'revoked'});
  await assert.rejects(()=>websiteRequest(config,'poll',{}, {fetcher:async()=>json({},409)}),{kind:'expired'});
});
test('native website transport cannot add browser fetch headers or follow a redirect',async()=>{
  let requests=0;const response=await websiteRequest(config,'heartbeat',{}, {fetcher:(url,options)=>nativeWebsiteFetch(url,options,{request:(target,requestOptions,callback)=>{
    requests++;assert.equal(target,config.origin+'/api/image-worker?action=heartbeat');assert.deepEqual(Object.keys(requestOptions.headers).sort(),['Authorization','Content-Type']);assert.equal(requestOptions.headers.Authorization,'Bearer '+TOKEN);
    const outgoing=new EventEmitter();outgoing.end=body=>{assert.equal(body,'{}');const incoming=Readable.from([JSON.stringify({connected:true})]);incoming.statusCode=200;incoming.rawHeaders=['content-type','application/json'];callback(incoming);};return outgoing;
  }})});assert.deepEqual(response,{connected:true});assert.equal(requests,1);
});
test('intent and result are durable before their external actions; upload retries do not regenerate',async()=>{
  const store=memoryStore(),logs=[];let model=0,upload=0;
  const processor=createJobProcessor({store,configuration:config,apiKey:SECRET,logger:s=>logs.push(s),wait:async()=>{},providerFetcher:async()=>{model++;assert.equal(store.get().state,'intent');return json({data:[{b64_json:png}]});},fetcher:async(url,options)=>{upload++;assert.equal(store.get().state,'result');assert.deepEqual(JSON.parse(options.body),{id,lease:LEASE,dataUrl:image});if(upload<3)throw Error(SECRET);return json({saved:true,status:'done'});}});
  await processor.process(job);assert.equal(model,1);assert.equal(upload,3);assert.equal(store.get().state,'acknowledged');assert.ok(!JSON.stringify(store.get()).includes(image));assert.ok(!JSON.stringify(store.get()).includes(LEASE));assert.ok(!logs.join().includes(SECRET));
});
test('recovery turns an unfinished intent into uncertainty and never calls the provider',async()=>{
  const store=memoryStore(intent);let provider=0;const processor=createJobProcessor({store,configuration:config,apiKey:SECRET,logger:()=>{},providerFetcher:async()=>{provider++;throw Error('must not generate');},fetcher:async(url,options)=>{assert.equal(store.get().state,'result');assert.deepEqual(JSON.parse(options.body),{id,lease:LEASE,error:'UNCERTAIN'});return json({saved:true,status:'uncertain'});}});
  await processor.recover();assert.equal(provider,0);assert.equal(store.get().state,'acknowledged');assert.equal(store.get().status,'uncertain');
});
test('saved images recover by upload alone; stale leases retain a review receipt without regeneration',async()=>{
  const store=memoryStore({...intent,state:'result',result:{dataUrl:image}});let provider=0;const processor=createJobProcessor({store,configuration:config,apiKey:SECRET,logger:()=>{},providerFetcher:async()=>{provider++;},fetcher:async()=>json({},409)});
  await assert.rejects(()=>processor.recover(),{kind:'expired'});assert.equal(provider,0);assert.equal(store.get().state,'review');assert.equal(store.get().result.dataUrl,image);await processor.recover();await assert.rejects(()=>processor.process(job),/重复任务/);assert.equal(provider,0);
});
test('failed result persistence leaves intent for safe recovery instead of uploading or regenerating',async()=>{
  const backing=memoryStore();let uploads=0,provider=0;const store={...backing,write:async receipt=>{if(receipt.state==='result')throw Error('disk failed');await backing.write(receipt);}};
  await assert.rejects(()=>createJobProcessor({store,configuration:config,apiKey:SECRET,logger:()=>{},providerFetcher:async()=>{provider++;return json({data:[{b64_json:png}]});},fetcher:async()=>{uploads++;return json({});}}).process(job));assert.equal(backing.get().state,'intent');assert.equal(provider,1);assert.equal(uploads,0);
  await createJobProcessor({store:backing,configuration:config,apiKey:SECRET,logger:()=>{},providerFetcher:async()=>{provider++;},fetcher:async()=>json({saved:true,status:'uncertain'})}).recover();assert.equal(provider,1);
});
test('revoked credentials leave the durable result and stop without retries',async()=>{
  const store=memoryStore({...intent,state:'result',result:{dataUrl:image}});let uploads=0;await assert.rejects(()=>createJobProcessor({store,configuration:config,apiKey:SECRET,logger:()=>{},fetcher:async()=>{uploads++;return json({},401);}}).recover(),{kind:'revoked'});assert.equal(uploads,1);assert.equal(store.get().state,'result');
});
test('filesystem receipts are private, atomically replaced, recoverable and contain no model key',async t=>{
  const d=await directory(t),store=await createReceiptStore(path.join(d,'receipts'));await store.write(intent);assert.equal((await fs.stat(path.join(d,'receipts'))).mode&0o777,0o700);assert.equal((await fs.stat(path.join(d,'receipts',id+'.json'))).mode&0o777,0o600);assert.deepEqual(await store.pending(),[intent]);await store.write({...intent,state:'result',result:{dataUrl:image}});assert.equal((await store.read(id)).result.dataUrl,image);assert.ok(!(await fs.readFile(path.join(d,'receipts',id+'.json'),'utf8')).includes(SECRET));assert.deepEqual((await fs.readdir(path.join(d,'receipts'))),[id+'.json']);
});
test('an injected filesystem failure prevents the first provider POST and sanitizes the error',async t=>{
  const d=await directory(t),store=await createReceiptStore(path.join(d,'receipts'),{io:{...fs,open:async()=>{throw Error(SECRET);}}});let provider=0;
  await assert.rejects(()=>createJobProcessor({store,configuration:config,apiKey:SECRET,logger:()=>{},providerFetcher:async()=>{provider++;}}).process(job),error=>error.message==='本机回执保存失败，已停止生成');assert.equal(provider,0);
});
test('startup recovers before metadata check, then refuses new jobs if metadata is unavailable',async t=>{
  const d=await directory(t),file=path.join(d,'connection.json');await fs.writeFile(file,JSON.stringify(config));const store=await createReceiptStore(path.join(d,'receipts'));await store.write({...intent,state:'result',result:{dataUrl:image}});const events=[];
  await assert.rejects(()=>startWorker(file,{apiKey:SECRET,logger:()=>{},fetcher:async url=>{events.push('upload');assert.ok(url.endsWith('action=complete'));return json({saved:true,status:'done'});},providerFetcher:async()=>{events.push('metadata');return json({},403);}}),/HTTP 403/);assert.deepEqual(events,['upload','metadata']);assert.equal((await store.read(id)).state,'acknowledged');await assert.rejects(()=>fs.stat(path.join(d,'worker.lock')),{code:'ENOENT'});
});
test('a running worker lock prevents a second process from contacting any service',async t=>{
  const d=await directory(t),file=path.join(d,'connection.json');await fs.writeFile(file,JSON.stringify(config));await fs.writeFile(path.join(d,'worker.lock'),'123');let count=0;await assert.rejects(()=>startWorker(file,{apiKey:SECRET,fetcher:async()=>count++,providerFetcher:async()=>count++}),/已运行/);assert.equal(count,0);
});
