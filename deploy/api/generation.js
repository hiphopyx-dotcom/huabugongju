import {neon} from '@neondatabase/serverless';
import {createQuotaService} from '../lib/quota.mjs';
import {createGenerationHandler} from '../lib/generation.mjs';
import {withCors} from '../lib/security.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'生成服务尚未配置'},{status:503,headers:{'Cache-Control':'no-store'}});const sql=neon(process.env.DATABASE_URL);const query=(query,params)=>sql.query(query,params);return createGenerationHandler(query,{quota:createQuotaService(query)})(req)}
const route=withCors(handler);
export {route as GET,route as POST,route as OPTIONS};
