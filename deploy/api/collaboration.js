import {neon} from '@neondatabase/serverless';
import {createCollaborationHandler} from '../lib/collaboration.mjs';
import {withCors} from '../lib/security.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'协作服务尚未配置'},{status:503,headers:{'Cache-Control':'no-store'}});const sql=neon(process.env.DATABASE_URL);return createCollaborationHandler((query,params)=>sql.query(query,params))(req)}
const route=withCors(handler);
export {route as GET,route as POST,route as PUT,route as DELETE,route as OPTIONS};
