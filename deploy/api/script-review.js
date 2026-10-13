import {neon} from '@neondatabase/serverless';
import {createScriptReviewHandler} from '../lib/script-review.mjs';
async function handler(req){
 if(!process.env.DATABASE_URL)return Response.json({error:'账户服务尚未配置'},{status:503});
 return createScriptReviewHandler((sql,params)=>neon(process.env.DATABASE_URL).query(sql,params))(req);
}
export {handler as GET,handler as POST};
