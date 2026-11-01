import { neon } from '@neondatabase/serverless';
import { createBackupHandler } from '../lib/phone-access.mjs';

async function handler(req) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: '未配置' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const sql = neon(process.env.DATABASE_URL);
  return createBackupHandler((query, params) => sql.query(query, params))(req);
}
export { handler as GET };
