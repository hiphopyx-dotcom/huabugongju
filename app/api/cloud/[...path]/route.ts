import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { handleCloud } from '../../../../lib/cloud-service.mjs';
export const dynamic='force-dynamic';
async function handler(request:Request){return handleCloud(request,env,await getChatGPTUser())}
export {handler as GET,handler as POST,handler as PUT,handler as DELETE};
