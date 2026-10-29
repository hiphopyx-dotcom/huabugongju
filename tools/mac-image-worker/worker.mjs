import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import {Readable} from 'node:stream';

export const ORIGINS = Object.freeze(['https://unfair-pony-d7gvmlx4ne8e8796a-1515553937.ap-shanghai.app.tcloudbase.com', 'https://jubaopeng-canvas.vercel.app']);
const API = 'https://api.x.ai/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RATIOS = ['9:16','16:9','1:1','4:3','3:4'];
const IMAGE_BYTES = 3 * 1024 * 1024;
// Stored gallery references may be larger than new inline reference uploads.
const REFERENCE_BYTES = IMAGE_BYTES;
const POLL_BYTES = 3 * (Math.ceil(REFERENCE_BYTES / 3) * 4 + 64) + 65536;
const MAX_RESPONSE = Math.ceil(IMAGE_BYTES / 3) * 4 + 100000;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const only = (x, keys) => object(x) && Object.keys(x).every(k => keys.includes(k));
const invalid = () => {throw Error('配置或任务格式无效');};
export function validateConfig(value) {
  if (!only(value,['format','origin','workerId','workerToken']) || value.format !== 'jbp-mac-image-worker-v1'
    || !ORIGINS.includes(value.origin) || value.workerId !== 'primary' || typeof value.workerToken !== 'string' || !TOKEN.test(value.workerToken)) invalid();
  return value;
}
export function validateKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 16384 || /[\s\x00-\x1f\x7f]/.test(value.trim())) throw Error('请在本机填写有效模型密钥');
  return value.trim();
}
export function validateDataUrl(value, maxBytes = IMAGE_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 64) invalid();
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m || m[2].length % 4) invalid();
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== m[2]) invalid();
  const valid = m[1] === 'image/png' ? bytes.length >= 45 && bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' && bytes.toString('ascii',12,16) === 'IHDR' && bytes.toString('ascii',bytes.length-8,bytes.length-4) === 'IEND'
    : m[1] === 'image/jpeg' ? bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
    : bytes.length >= 30 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!valid) invalid();
  return value;
}
export function validateJob(value) {
  if (!only(value,['id','lease','prompt','ratio','resolution','references']) || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.lease !== 'string' || !TOKEN.test(value.lease)
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 8000 || !RATIOS.includes(value.ratio)
    || !['1k','2k'].includes(value.resolution) || !Array.isArray(value.references) || value.references.length > 3) invalid();
  value.references.forEach(x => validateDataUrl(x, REFERENCE_BYTES));
  return value;
}
async function boundedJson(response, limit) {
  if (Number(response.headers?.get('content-length')) > limit) throw Error('响应过大');
  if (!response.body) throw Error('没有响应');
  const chunks = [], reader = response.body.getReader(); let size = 0;
  try {
    for (;;) {const {done,value} = await reader.read(); if (done) break; size += value.byteLength;
      if (size > limit) {await reader.cancel(); throw Error('响应过大');} chunks.push(Buffer.from(value));}
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function discard(response) {try {await response.body?.cancel();} catch {}}
const combined = (signal, timeout) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
/** Reads only HTTP status, never the metadata response or account fields. */
export async function checkConnection(apiKey, {fetcher = fetch, signal} = {}) {
  try {
    const response = await fetcher(API + '/api-key', {method:'GET', redirect:'error', headers:{Authorization:'Bearer ' + validateKey(apiKey)}, signal:combined(signal,10000)});
    const status = response.status; await discard(response);
    return {ok:status === 200, status:Number.isInteger(status) && status >= 100 && status <= 599 ? status : null};
  } catch {return {ok:false,status:null};}
}
/** Exactly one provider POST. It intentionally has no retry branch. */
export async function generateImage(job, apiKey, {fetcher = fetch, signal} = {}) {
  try {
    validateJob(job); const key = validateKey(apiKey);
    const body = {model:'grok-imagine-image-2.0', prompt:job.prompt, n:1, quality:'low', resolution:job.resolution, aspect_ratio:job.ratio, response_format:'b64_json'};
    if (job.references.length === 1) body.image = {type:'image_url',url:job.references[0]};
    else if (job.references.length) body.images = job.references.map(url => ({type:'image_url',url}));
    const response = await fetcher(API + (job.references.length ? '/images/edits' : '/images/generations'), {
      method:'POST', redirect:'error', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + key}, body:JSON.stringify(body), signal:combined(signal,110000),
    });
    if (!response.ok) {await discard(response); return {error:response.status >= 400 && response.status < 500 && response.status !== 408 ? 'REJECTED' : 'UNCERTAIN'};}
    const result = await boundedJson(response,MAX_RESPONSE);
    if (!Array.isArray(result.data) || result.data.length !== 1 || typeof result.data[0]?.b64_json !== 'string') return {error:'UNCERTAIN'};
    const b64 = result.data[0].b64_json;
    if (b64.length > Math.ceil(IMAGE_BYTES / 3) * 4) return {error:'UNCERTAIN'};
    const prefix = Buffer.from(b64.slice(0,64),'base64');
    const mime = prefix.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : prefix[0] === 255 && prefix[1] === 216 ? 'image/jpeg' : prefix.toString('ascii',0,4) === 'RIFF' ? 'image/webp' : '';
    return {dataUrl:validateDataUrl('data:' + mime + ';base64,' + b64)};
  } catch {return {error:'UNCERTAIN'};}
}
function validateResult(value) {
  if (only(value,['error']) && ['REJECTED','UNCERTAIN'].includes(value.error)) return value;
  if (only(value,['dataUrl']) && typeof value.dataUrl === 'string') {validateDataUrl(value.dataUrl); return value;}
  invalid();
}
function validateReceipt(value) {
  if (!only(value,['version','state','id','lease','result','created','updated','status']) || value.version !== 1 || typeof value.id !== 'string' || !UUID.test(value.id)
    || !['intent','result','review','acknowledged'].includes(value.state) || !Number.isSafeInteger(value.created) || !Number.isSafeInteger(value.updated)) invalid();
  if (value.state !== 'acknowledged') {if (typeof value.lease !== 'string' || !TOKEN.test(value.lease)) invalid(); if (value.state === 'result' || value.state === 'review') validateResult(value.result);}
  return value;
}
export async function createReceiptStore(directory, {io = fs} = {}) {
  await io.mkdir(directory,{recursive:true,mode:0o700}); await io.chmod(directory,0o700);
  async function read(id) {
    const file = path.join(directory,id + '.json');
    try {const st = await io.stat(file); if (st.size > MAX_RESPONSE + 4096) invalid(); return validateReceipt(JSON.parse(await io.readFile(file,'utf8')));}
    catch (error) {if (error?.code === 'ENOENT') return null; throw Error('本机回执需核对，已停止生成');}
  }
  async function write(receipt) {
    validateReceipt(receipt); const destination = path.join(directory,receipt.id + '.json');
    const temporary = destination + '.' + process.pid + '.tmp'; let handle;
    try {handle = await io.open(temporary,'wx',0o600); await handle.writeFile(JSON.stringify(receipt)); await handle.sync(); await handle.close(); handle = null;
      await io.rename(temporary,destination); await io.chmod(destination,0o600);
      const folder = await io.open(directory,'r'); try {await folder.sync();} finally {await folder.close();}
    } catch {await handle?.close().catch(()=>{}); await io.unlink(temporary).catch(()=>{}); throw Error('本机回执保存失败，已停止生成');}
  }
  async function pending() {const files = (await io.readdir(directory)).filter(x => UUID.test(x.slice(0,-5)) && x.endsWith('.json')).sort(); const result=[];
    for (const file of files) {const item = await read(file.slice(0,-5)); if (item && ['intent','result'].includes(item.state)) result.push(item);} return result;}
  return {read,write,pending};
}
function requestError(kind) {return Object.assign(Error(kind === 'revoked' ? '工作端连接已撤销' : kind === 'expired' ? '任务凭据已过期，回执已保留' : '网站连接暂不可用'),{kind});}
// Native HTTPS avoids Node fetch adding browser Sec-Fetch headers. Redirects are never followed.
export function nativeWebsiteFetch(url, options, {request = https.request} = {}) {
  return new Promise((resolve,reject)=>{
    let outgoing;
    try {outgoing=request(url,{method:options.method,headers:options.headers,signal:options.signal},incoming=>{
      try {const headers=new Headers();for (let i=0;i<incoming.rawHeaders.length;i+=2) headers.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
        resolve({status:incoming.statusCode,ok:incoming.statusCode>=200&&incoming.statusCode<300,headers,body:Readable.toWeb(incoming)});
      } catch (error) {incoming.destroy();reject(error);}
    });outgoing.once('error',reject);outgoing.end(options.body);} catch (error) {outgoing?.destroy();reject(error);}
  });
}
export async function websiteRequest(configuration, action, body = {}, {fetcher = nativeWebsiteFetch, signal} = {}) {
  validateConfig(configuration);
  if (!['heartbeat','poll','complete'].includes(action)) invalid();
  let response;
  try {response = await fetcher(configuration.origin + '/api/image-worker?action=' + action, {method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + configuration.workerToken},body:JSON.stringify(body),signal:combined(signal,25000)});}
  catch {throw requestError('temporary');}
  if (response.status === 401 || response.status === 403) {await discard(response); throw requestError('revoked');}
  if (response.status === 409) {await discard(response); throw requestError('expired');}
  if (!response.ok) {await discard(response); throw requestError('temporary');}
  try {return await boundedJson(response,action === 'poll' ? POLL_BYTES : 65536);} catch {throw requestError('temporary');}
}
export function pause(ms, signal) {return new Promise(resolve => {if (signal?.aborted) return resolve(); const end = () => {clearTimeout(timer);signal?.removeEventListener('abort',end);resolve();}, timer=setTimeout(end,ms);signal?.addEventListener('abort',end,{once:true});});}
export function createJobProcessor({store,configuration,apiKey,fetcher=nativeWebsiteFetch,providerFetcher=fetch,signal,logger=console.log,wait=pause,now=Date.now}) {
  const log = text => {try {logger(text);} catch {}};
  async function deliver(receipt) {
    if (receipt.state === 'intent') {receipt = {...receipt,state:'result',result:{error:'UNCERTAIN'},updated:now()}; await store.write(receipt); log('发现未完成回执，未重复请求模型，正在回传待核对状态。');}
    for (let attempt=0;attempt<3;attempt++) {
      try {
        const response = await websiteRequest(configuration,'complete',{id:receipt.id,lease:receipt.lease,...receipt.result},{fetcher,signal});
        if (response?.saved !== true || !['done','failed','uncertain'].includes(response.status)) throw requestError('temporary');
        await store.write({version:1,state:'acknowledged',id:receipt.id,status:response.status,created:receipt.created,updated:now()});
        log(receipt.result.dataUrl ? '图片已回传网站。' : '任务状态已回传，未重复生成。'); return response;
      } catch (error) {if (error?.kind === 'expired') await store.write({...receipt,state:'review',updated:now()});
        if (error?.kind === 'revoked' || error?.kind === 'expired' || attempt===2 || signal?.aborted) throw error; await wait(2000,signal);}
    }
  }
  return {
    async recover() {for (const receipt of await store.pending()) await deliver(receipt);},
    async process(rawJob) {
      const job = validateJob(rawJob), existing = await store.read(job.id);
      if (existing) {if (!['intent','result'].includes(existing.state) || existing.lease !== job.lease) throw Error('检测到重复任务，已停止生成'); return deliver(existing);}
      const receipt = {version:1,state:'intent',id:job.id,lease:job.lease,created:now(),updated:now()};
      await store.write(receipt);
      const result = await generateImage(job,apiKey,{fetcher:providerFetcher,signal});
      const finished = {...receipt,state:'result',result,updated:now()}; await store.write(finished);
      return deliver(finished);
    },
  };
}
export async function startWorker(configFile,{signal,apiKey=process.env.XAI_API_KEY,fetcher=nativeWebsiteFetch,providerFetcher=fetch,logger=console.log,pollMs=2500,allowPaidApi=process.env.JBP_ALLOW_XAI_API==='1'}={}) {
  // This worker calls the paid xAI image API; it stays off unless explicitly allowed.
  if (!allowPaidApi) throw Error('付费 xAI 图片接口已停用；请改用 Grok 会员执行器（tools/grok-member-worker）');
  const stat = await fs.stat(configFile); if (stat.size > 16384) invalid();
  const configuration = validateConfig(JSON.parse(await fs.readFile(configFile,'utf8'))); const key = apiKey;
  const directory = path.dirname(configFile); await fs.mkdir(directory,{recursive:true,mode:0o700}); await fs.chmod(directory,0o700); await fs.chmod(configFile,0o600);
  const lock = path.join(directory,'worker.lock'); let lockHandle;
  try {lockHandle = await fs.open(lock,'wx',0o600); await lockHandle.writeFile(String(process.pid)); await lockHandle.sync();} catch {throw Error('图片工作端已运行，或上次退出的锁文件需检查');}
  const controller = new AbortController(), stop=()=>controller.abort();
  signal?.addEventListener('abort',stop,{once:true}); if (signal?.aborted) stop(); process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let heartbeatTimer, heartbeating=false;
  const log = text=>{try {logger(text);} catch {}};
  const request=(action,body={})=>websiteRequest(configuration,action,body,{fetcher,signal:controller.signal});
  const heartbeat=async()=>{if (heartbeating || controller.signal.aborted) return;heartbeating=true;try {await request('heartbeat');} catch (error) {if (error?.kind==='revoked') {log('工作端连接已撤销，已停止。');stop();}} finally {heartbeating=false;}};
  try {
    const store=await createReceiptStore(path.join(directory,'receipts'));
    const processor=createJobProcessor({store,configuration,apiKey:key,fetcher,providerFetcher,signal:controller.signal,logger:log});
    // Recover before polling: an interrupted model request is never generated again.
    await processor.recover();
    const connected=await checkConnection(key,{fetcher:providerFetcher,signal:controller.signal});
    if (!connected.ok) throw Error(connected.status ? '模型认证检查未通过（HTTP '+connected.status+'），未开始领取任务。' : '本机暂时无法连接模型，未开始领取任务。');
    log('模型连接验证通过。');
    await request('heartbeat'); heartbeatTimer=setInterval(heartbeat,15000); log('图片工作端已连接，正在等待任务。');
    while (!controller.signal.aborted) {
      try {const data=await request('poll'); if (data.job) {validateJob(data.job); log('收到图片任务，正在处理。'); await processor.process(data.job);}}
      catch (error) {if (error?.kind==='revoked') {log('工作端连接已撤销，已停止。');stop();}
        else if (error?.kind==='expired') {log('任务执行凭据已过期，回执已保留，已停止。');stop();}
        else if (!controller.signal.aborted) {log('连接或回执需要核对，已停止领取新任务。');stop();}}
      await pause(pollMs,controller.signal);
    }
  } finally {clearInterval(heartbeatTimer);stop();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);signal?.removeEventListener('abort',stop);await lockHandle?.close();await fs.unlink(lock).catch(()=>{});}
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startWorker(process.argv[2]).catch(error=>{const message=error?.message||'',safe=['本机暂时无法连接模型，未开始领取任务。','图片工作端已运行，或上次退出的锁文件需检查','本机回执需核对，已停止生成','本机回执保存失败，已停止生成','任务凭据已过期，回执已保留','工作端连接已撤销'];console.error(/^模型认证检查未通过（HTTP \d{3}），未开始领取任务。$/.test(message)||safe.includes(message)?message:'图片工作端未启动或已停止，请检查本机连接配置、密钥和回执。');process.exitCode=1;});
}
