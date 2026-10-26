import {neon} from '@neondatabase/serverless';
import {createImageHandler,imageServerConfig} from '../lib/images.mjs';
async function handler(req){
 if(!process.env.DATABASE_URL)return Response.json({error:'图片服务尚未配置'},{status:503,headers:{'Cache-Control':'no-store'}});
 const sql=neon(process.env.DATABASE_URL),query=(statement,params)=>sql.query(statement,params);
 return createImageHandler(query,imageServerConfig(process.env))(req);
}
export {handler as GET,handler as POST};
export const maxDuration=150;
