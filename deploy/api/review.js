import {neon} from '@neondatabase/serverless';
import {createReviewHandler} from '../lib/review.mjs';
async function handler(req){
  if(!process.env.DATABASE_URL) return Response.json({error:'剧本评审数据库未配置'},{status:503});
  const sql=neon(process.env.DATABASE_URL);
  return createReviewHandler((query,params)=>sql.query(query,params))(req);
}
export {handler as GET,handler as POST};
