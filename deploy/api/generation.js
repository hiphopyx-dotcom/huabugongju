import {neon} from '@neondatabase/serverless';
import {createGenerationHandler} from '../lib/generation.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'生成服务尚未配置'},{status:503});const sql=neon(process.env.DATABASE_URL);return createGenerationHandler((query,params)=>sql.query(query,params))(req)}
export {handler as GET,handler as POST};
