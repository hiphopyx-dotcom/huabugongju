import {failure, limitedBytes} from './relay.mjs';

// Installed Mac workers trust this exact address; both entries share the same DB.
export const WORKER_ORIGIN = 'https://jubaopeng-canvas.vercel.app';
export const BODY_LIMITS = Object.freeze({image: 4 * 1024 * 1024 + 65536, other: 2_300_000});

export async function createBackend({query, publicOrigin, libraryRoot = new URL('../lib/', import.meta.url), env = process.env}) {
  if (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://')) throw Error('Exact HTTPS origin required');
  const [accounts, generation, assets, collaboration, sso, reference, images, quota] = await Promise.all(
    ['accounts', 'generation', 'assets', 'collaboration', 'sso', 'reference', 'images', 'quota'].map(name => import(new URL(name + '.mjs', libraryRoot)))
  );
  const routes = new Map([
    ['/api/accounts', [new Set(['GET', 'POST', 'PUT']), accounts.createAccountHandler(query, {setupToken: env.STUDIO_SETUP_TOKEN})]],
    ['/api/generation', [new Set(['GET', 'POST']), generation.createGenerationHandler(query, {quota: quota.createQuotaService(query)})]],
    ['/api/assets', [new Set(['GET', 'POST']), assets.createAssetHandler(query)]],
    ['/api/collaboration', [new Set(['GET', 'POST', 'PUT', 'DELETE']), collaboration.createCollaborationHandler(query)]],
    ['/api/sso', [new Set(['POST']), sso.createSsoHandler(query)]],
    ['/api/reference', [new Set(['GET']), reference.reference]],
    ['/api/images', [new Set(['GET', 'POST']), images.createImageHandler(query, images.imageServerConfig(env))]],
    ['/api/quota', [new Set(['GET', 'POST']), quota.createQuotaHandler(query)]],
  ]);
  return async request => {
    const url = new URL(request.url), route = routes.get(url.pathname);
    if (!route) return failure(404, '接口不存在');
    if (!route[0].has(request.method)) return failure(405, '请求方式不支持');
    const origin = request.headers.get('origin');
    const serverRedeem = url.pathname === '/api/sso' && url.searchParams.get('action') === 'redeem' && !origin;
    if (url.origin !== publicOrigin || (origin && origin !== publicOrigin)
      || (request.method !== 'GET' && !origin && !serverRedeem)
      || request.headers.get('sec-fetch-site') === 'cross-site') return failure(403, '请在当前网站内操作');
    // Worker authentication remains on the existing trusted entry, not this site.
    if (url.pathname === '/api/generation' && ['poll', 'heartbeat', 'complete'].includes(url.searchParams.get('action'))) return failure(404, '接口不存在');
    const headers = new Headers();
    for (const key of ['cookie', 'origin', 'content-type']) if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    let body;
    try { body = request.method === 'GET' ? undefined : await limitedBytes(request.body, url.pathname === '/api/images' ? BODY_LIMITS.image : BODY_LIMITS.other); }
    catch { return failure(413, '请求过大'); }
    const response = await route[1](new Request(request.url, {method: request.method, headers, body}));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/api/generation' && ['worker-config', 'script-worker-config'].includes(url.searchParams.get('action')) && response.ok) {
      const data = await response.json();
      if (data.config) data.config.origin = WORKER_ORIGIN;
      const resultHeaders = new Headers(response.headers);
      resultHeaders.delete('Content-Length');
      return Response.json(data, {status: response.status, headers: resultHeaders});
    }
    return response;
  };
}
