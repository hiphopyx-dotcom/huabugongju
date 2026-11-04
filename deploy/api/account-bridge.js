import { neon } from '@neondatabase/serverless';
import { createBackupHandler, createPhoneLoginHandler, createWhoamiHandler } from '../lib/phone-access.mjs';

const missing = () => Response.json({ ok: false, error: '未配置' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

function routeOf(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  if (action === 'phone-login' || url.pathname.endsWith('/phone-login')) return 'phone-login';
  if (action === 'whoami' || url.pathname.endsWith('/whoami')) return 'whoami';
  if (action === 'backup' || url.pathname.endsWith('/backup')) return 'backup';
  return '';
}

async function handler(req) {
  if (!process.env.DATABASE_URL) return missing();
  const sql = neon(process.env.DATABASE_URL);
  const query = (text, params) => sql.query(text, params);
  const route = routeOf(req);
  if (route === 'phone-login') return createPhoneLoginHandler(query, { setupToken: process.env.STUDIO_SETUP_TOKEN })(req);
  if (route === 'whoami') return createWhoamiHandler(query)(req);
  if (route === 'backup') return createBackupHandler(query)(req);
  return Response.json({ ok: false, error: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
export { handler as GET, handler as POST };
