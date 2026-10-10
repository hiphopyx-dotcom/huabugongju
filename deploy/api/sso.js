import {neon} from '@neondatabase/serverless';
import {createSsoHandler} from '../lib/sso.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'账户服务尚未配置'},{status:503});const sql=neon(process.env.DATABASE_URL);return createSsoHandler((query,params)=>sql.query(query,params))(req)}
export {handler as POST};
