import { neon } from '@neondatabase/serverless';
import { createPhoneLoginHandler } from '../lib/phone-access.mjs';

async function handler(req) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: '未配置' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const sql = neon(process.env.DATABASE_URL);
  return createPhoneLoginHandler((query, params) => sql.query(query, params), { setupToken: process.env.STUDIO_SETUP_TOKEN })(req);
}
export { handler as POST };
