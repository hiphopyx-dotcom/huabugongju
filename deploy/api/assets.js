import {neon} from '@neondatabase/serverless';
import {createAssetHandler} from '../lib/assets.mjs';
async function handler(req){if(!process.env.DATABASE_URL)return Response.json({error:'资产记录服务尚未配置'},{status:503});const sql=neon(process.env.DATABASE_URL);return createAssetHandler((query,params)=>sql.query(query,params))(req)}
export {handler as GET,handler as POST};
