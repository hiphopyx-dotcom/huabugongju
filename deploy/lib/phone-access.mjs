import { createAccountHandler } from './accounts.mjs';
import { AccountError, cookie, hash, safeOrigin } from './security.mjs';
import { smsConfigured } from './sms.mjs';

const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const notConfigured = () => json({ ok: false, error: '未配置' }, 503);

export function presentedToken(req) {
  const header = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(\S+)/i.exec(header);
  if (bearer) return bearer[1];
  return cookie(req);
}

function sessionTokenFromSetCookie(header) {
  const match = /(?:^|,\s*)__Host-jbp-session=([^;,\s]+)/.exec(header || '');
  return match ? match[1] : '';
}

async function readBody(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json') || !type) {
    const text = await req.text();
    if (text.length > 16384) throw new AccountError(413, '请求过大');
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new AccountError(400, '提交格式不对'); }
  }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await req.formData();
    return { phone: form.get('phone'), password: form.get('password'), code: form.get('code'), action: form.get('action') };
  }
  throw new AccountError(400, '提交格式不对');
}

function wantsHtml(req) {
  const accept = req.headers.get('accept') || '';
  const type = req.headers.get('content-type') || '';
  if (/\bapplication\/json\b/i.test(accept)) return false;
  return type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function htmlPage(message, status, setCookie) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  const body = `<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><title>手机号登录</title><p>${escapeHtml(message)}</p></html>`;
  return new Response(body, { status, headers });
}

async function currentUser(query, req) {
  const raw = presentedToken(req);
  if (!raw) return null;
  const now = Date.now();
  const rows = await query('SELECT a.id,a.phone,a.name,a.role,a.active FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version', [hash(raw), now]);
  return rows[0] || null;
}

export function createPhoneLoginHandler(query, config = {}) {
  const accounts = createAccountHandler(query, config);
  const env = config.env || process.env;
  return async function handle(req) {
    if (req.method !== 'POST') return json({ ok: false, error: '请使用 POST' }, 405);
    const html = wantsHtml(req);
    try {
      safeOrigin(req);
      const body = await readBody(req);
      if (body?.action === 'send' || (body && Object.hasOwn(body, 'code') && body.code != null && String(body.code) !== '')) {
        if (!smsConfigured(env)) {
          const payload = { ok: false, error: '短信服务未配置' };
          return html ? htmlPage(payload.error, 503) : json(payload, 503);
        }
        const payload = { ok: false, error: '短信服务未接入' };
        return html ? htmlPage(payload.error, 503) : json(payload, 503);
      }
      const inner = await accounts(new Request(new URL('/api/accounts?action=login', req.url), {
        method: 'POST',
        headers: { Origin: req.headers.get('origin') || '', 'Content-Type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') || '' },
        body: JSON.stringify({ phone: body?.phone, password: body?.password }),
      }));
      const data = await inner.json();
      const setCookie = inner.headers.get('set-cookie') || '';
      if (!inner.ok) {
        const error = data.error || '手机号或密码错误';
        return html ? htmlPage(error, inner.status) : json({ ok: false, error }, inner.status);
      }
      const tokenValue = sessionTokenFromSetCookie(setCookie);
      if (html) return htmlPage('已登录，请返回工作台', 200, setCookie);
      return json({ ok: true, token: tokenValue, user: { id: data.user.id, name: data.user.name, phone: data.user.phone, role: data.user.role } }, 200, setCookie ? { 'Set-Cookie': setCookie } : {});
    } catch (error) {
      const status = error.status || 503;
      const message = error.status ? error.message : '登录暂不可用';
      return html ? htmlPage(message, status) : json({ ok: false, error: message }, status);
    }
  };
}

export function createWhoamiHandler(query, config = {}) {
  return async function handle(req) {
    if (config.database === false) return notConfigured();
    if (req.method !== 'GET') return json({ ok: false, error: '请使用 GET' }, 405);
    try {
      safeOrigin(req);
      const user = await currentUser(query, req);
      if (!user) return json({ ok: false, error: '请先登录' }, 401);
      return json({ ok: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
    } catch (error) {
      return json({ ok: false, error: error.status ? error.message : '登录暂不可用' }, error.status || 503);
    }
  };
}

const OPTIONAL = [
  ['studio_image_jobs', 'SELECT id,request_key,project_id,project_title,name,asset_kind,prompt,ratio,resolution,status,error,amount,created,updated FROM studio_image_jobs WHERE owner=$1 ORDER BY created,id'],
  ['studio_images', 'SELECT id,project_id,project_title,name,asset_kind,prompt,ratio,resolution,width,height,mime,bytes,source,request_key,created FROM studio_images WHERE owner=$1 ORDER BY created,id'],
];

export function createBackupHandler(query, config = {}) {
  return async function handle(req) {
    if (config.database === false) return notConfigured();
    if (req.method !== 'GET') return json({ ok: false, error: '请使用 GET' }, 405);
    try {
      safeOrigin(req);
      const user = await currentUser(query, req);
      if (!user) return json({ ok: false, error: '请先登录' }, 401);
      const id = user.id;
      const q = (sql, ...params) => query(sql, params);
      const data = {
        account: [{ id: user.id, phone: user.phone, name: user.name, role: user.role, active: user.active }],
        generation_jobs: await q('SELECT id,request_key,prompt,status,result,error,created,updated FROM studio_generation_jobs WHERE owner=$1 ORDER BY created,id', id),
        asset_records: await q('SELECT project_id,asset_id,project_title,name,kind,provenance,prompt,media_url,created,synced FROM studio_asset_records WHERE owner=$1 ORDER BY created,asset_id', id),
        quota_wallet: await q('SELECT allowance,updated FROM studio_quota_wallets WHERE owner=$1', id),
        quota_entries: await q('SELECT request_key,kind,state,reserved,charged,detail,created,updated FROM studio_quota_entries WHERE owner=$1 ORDER BY created,request_key', id),
        collab_rooms: await q('SELECT id,title,document,revision,updated FROM studio_collab_rooms WHERE owner=$1 ORDER BY updated,id', id),
        collab_memberships: await q('SELECT room_id,role FROM studio_collab_members WHERE user_id=$1 ORDER BY room_id', id),
      };
      for (const [name, sql] of OPTIONAL) {
        try { data[name] = await q(sql, id); }
        catch (error) {
          if (!/no such table|does not exist/i.test(String(error.message || ''))) throw error;
        }
      }
      const body = JSON.stringify({ at: Date.now(), user_id: id, format: 'jubaopeng-account-backup-v1', data });
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="jubaopeng-backup.json"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      return json({ ok: false, error: error.status ? error.message : '备份暂不可用' }, error.status || 503);
    }
  };
}
