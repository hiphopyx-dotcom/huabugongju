import {neon} from '@neondatabase/serverless';
import {createImageWorkerHandler} from '../lib/image-worker.mjs';
async function handler(req){
 if(!process.env.DATABASE_URL)return Response.json({error:'模型服务暂不可用'},{status:503,headers:{'Cache-Control':'no-store'}});
 const publicOrigin=new URL(req.url).origin,sql=neon(process.env.DATABASE_URL);
 return createImageWorkerHandler((statement,params)=>sql.query(statement,params),{publicOrigin})(req);
}
export {handler as GET,handler as POST};
export const maxDuration=30;
