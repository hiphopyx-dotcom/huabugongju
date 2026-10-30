import {neon} from '@neondatabase/serverless';
import {createImageHandler,imageServerConfig} from '../lib/images.mjs';
import {withCors} from '../lib/security.mjs';
async function handler(req){
 if(!process.env.DATABASE_URL)return Response.json({error:'图片服务尚未配置'},{status:503,headers:{'Cache-Control':'no-store'}});
 const sql=neon(process.env.DATABASE_URL),query=(statement,params)=>sql.query(statement,params);
 return createImageHandler(query,imageServerConfig(process.env))(req);
}
const route=withCors(handler);
export {route as GET,route as POST,route as OPTIONS};
export const maxDuration=150;
