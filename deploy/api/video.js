import {neon} from '@neondatabase/serverless';
import {createVideoHandler} from '../lib/video.mjs';
async function handler(req){
  if(!process.env.DATABASE_URL)return Response.json({error:'视频任务数据库尚未配置'},{status:503});
  const sql=neon(process.env.DATABASE_URL);
  return createVideoHandler((query,params)=>sql.query(query,params))(req);
}
export {handler as GET,handler as POST};
