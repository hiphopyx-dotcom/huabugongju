import {neon} from '@neondatabase/serverless';
import {createCollaborationHandler} from '../lib/collaboration.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'协作服务尚未配置'},{status:503});const sql=neon(process.env.DATABASE_URL);return createCollaborationHandler((query,params)=>sql.query(query,params))(req)}
export {handler as GET,handler as POST,handler as PUT,handler as DELETE};
