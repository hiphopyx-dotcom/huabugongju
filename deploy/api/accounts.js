import {neon} from '@neondatabase/serverless';
import {createAccountHandler} from '../lib/accounts.mjs';
import {withCors} from '../lib/security.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'账户服务尚未配置'},{status:503,headers:{'Cache-Control':'no-store'}});const sql=neon(process.env.DATABASE_URL);return createAccountHandler((query,params)=>sql.query(query,params),{setupToken:process.env.STUDIO_SETUP_TOKEN})(req)}
const route=withCors(handler);
export {route as GET,route as POST,route as PUT,route as OPTIONS};
