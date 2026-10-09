import {neon} from '@neondatabase/serverless';
import {createAccountHandler} from '../lib/accounts.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'账户服务尚未配置'},{status:503});const sql=neon(process.env.DATABASE_URL);return createAccountHandler((query,params)=>sql.query(query,params),{setupToken:process.env.STUDIO_SETUP_TOKEN})(req)}
export {handler as GET,handler as POST,handler as PUT};
