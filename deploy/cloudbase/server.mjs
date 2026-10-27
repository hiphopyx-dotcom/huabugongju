import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {failure} from './relay.mjs';
import {createBackend} from './backend.mjs';

const TYPES = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2',
  '.mp4':'video/mp4','.webm':'video/webm','.zip':'application/zip',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};

export async function createStudioApp({publicDir, apiHandler = async () => failure(503,'账户服务尚未配置')}) {
  // Only generated public files are routable; shared server imports are excluded.
  const entries = JSON.parse(await fs.readFile(path.join(publicDir,'manifest.json'),'utf8'));
  const files = new Set(entries.filter(name => typeof name === 'string' && !path.isAbsolute(name)
    && !name.split('/').some(part => part === '..' || part.startsWith('.')) && !name.startsWith('studio/')));
  const release = JSON.parse(await fs.readFile(path.join(publicDir,'release.json'),'utf8'));
  return async request => {
    const url = new URL(request.url);
    if(url.pathname.startsWith('/api/')) return apiHandler(request);
    if(!['GET','HEAD'].includes(request.method)) return failure(405,'请求方式不支持');
    if(url.pathname === '/healthz') return Response.json({ok:true,service:'jbp-workbench',release},
      {headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    let filename;
    try { filename = decodeURIComponent(url.pathname).slice(1) || 'index.html'; }
    catch { return failure(400,'路径无效'); }
    if(!files.has(filename)) return failure(404,'页面不存在');
    const data = request.method === 'HEAD' ? null : await fs.readFile(path.join(publicDir,filename));
    return new Response(data,{headers:{'Content-Type':TYPES[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN'}});
  };
}

export function createNodeServer(handle,publicOrigin) {
  if(new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://')) throw Error('Exact HTTPS origin required');
  return http.createServer(async(incoming,outgoing) => {
    try {
      if(!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400).end(); return; }
      // The configured origin, rather than Host / forwarded headers, is trusted.
      const request = new Request(publicOrigin + incoming.url,{method:incoming.method,headers:incoming.headers,
        ...(['GET','HEAD'].includes(incoming.method) ? {} : {body:incoming,duplex:'half'})});
      const response = await handle(request);
      outgoing.statusCode = response.status;
      for(const [key,value] of response.headers) if(key !== 'set-cookie') outgoing.setHeader(key,value);
      const cookies = response.headers.getSetCookie();
      if(cookies.length) outgoing.setHeader('Set-Cookie',cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if(!outgoing.headersSent) outgoing.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      outgoing.end(JSON.stringify({error:'服务暂不可用，请稍后重试'}));
    }
  });
}

if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const publicOrigin = process.env.JBP_PUBLIC_ORIGIN;
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const apiHandler = await createBackend({publicOrigin,libraryRoot:new URL('./deploy/lib/',import.meta.url),
    query:(text,params) => sql.query(text,params,{fetchOptions:{signal:AbortSignal.timeout(25_000)}}),env:process.env});
  const handle = await createStudioApp({publicDir,apiHandler});
  createNodeServer(handle,publicOrigin).listen(9000,'0.0.0.0');
}
