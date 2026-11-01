import {neon} from '@neondatabase/serverless';
import {createSkillHandler, skillsEnabled} from '../lib/skills.mjs';
import {withCors} from '../lib/security.mjs';

async function handler(req) {
  if (!skillsEnabled()) return createSkillHandler(async () => { throw Error('不应查询数据库'); })(req);
  if (!process.env.DATABASE_URL) return Response.json({error: '技能库尚未配置'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  const sql = neon(process.env.DATABASE_URL);
  return createSkillHandler((query, params) => sql.query(query, params))(req);
}
const route = withCors(handler);
export {route as GET, route as POST, route as OPTIONS};
