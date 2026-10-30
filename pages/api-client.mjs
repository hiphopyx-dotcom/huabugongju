const TOKEN_KEY = 'jbp-bench-token';

export function apiBase() {
  if (typeof document === 'undefined') return '';
  return document.querySelector('meta[name="studio-api-base"]')?.getAttribute('content') || '';
}

export function authToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function rememberToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* 私密窗口可能禁掉 sessionStorage，退回访客 */ }
}

export async function hydrateAuthedImages(root) {
  if (!apiBase() || !root?.querySelectorAll) return;
  for (const img of root.querySelectorAll('img[src^="/api/"]')) {
    const src = img.getAttribute('src');
    if (!src || img.dataset.authed === src) continue;
    img.dataset.authed = src;
    const response = await apiFetch(src);
    if (!response.ok) continue;
    img.src = URL.createObjectURL(await response.blob());
  }
}

export async function apiFetch(path, opts = {}) {
  const base = apiBase();
  const headers = new Headers(opts.headers || {});
  const token = authToken();
  if (base && token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
  const credentials = base ? 'omit' : (opts.credentials || 'same-origin');
  try {
    const response = await fetch((base || '') + path, {...opts, headers, credentials});
    if (response.status === 401 && base) rememberToken('');
    return response;
  } catch {
    if (!base) throw Error('网络请求失败');
    rememberToken('');
    return new Response(JSON.stringify({error:'后台暂时连不上，已退回访客'}), {status:503, headers:{'Content-Type':'application/json'}});
  }
}
