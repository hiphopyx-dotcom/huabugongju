import {randomUUID} from 'node:crypto';
import {AccountError,allowBearerOrigin,sessionToken,hash} from './security.mjs';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const text=(value,max)=>typeof value==='string'&&value.length<=max?value:'';

export function createPublishHandler(query){
  return async function handle(req){
    try{
      allowBearerOrigin(req);
      const url=new URL(req.url), action=url.searchParams.get('action')||'list', now=Date.now();
      const q=(sql,...params)=>query(sql,params), one=async(sql,...params)=>(await q(sql,...params))[0];
      const raw=sessionToken(req);
      const user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),now):null;
      if((action==='list'||action==='get')&&req.method==='GET'){
        if(action==='list')return json({items:await q("SELECT id,kind,subject_id,title,updated FROM studio_publications WHERE revoked=false AND kind='project' ORDER BY updated DESC LIMIT 100")});
        const id=url.searchParams.get('id')||'';
        const row=await one('SELECT id,kind,subject_id,title,payload,updated FROM studio_publications WHERE id=$1 AND revoked=false',id);
        if(!row)throw new AccountError(404,'公开内容不存在或已收回');
        return json({item:{...row,payload:JSON.parse(row.payload)}});
      }
      if(!user)throw new AccountError(401,'请先登录');
      if(action==='snapshot-latest'&&req.method==='GET'){
        const projectId=text(url.searchParams.get('projectId'),128);
        const row=await one('SELECT id,payload,created FROM studio_project_snapshots WHERE owner=$1 AND project_id=$2 ORDER BY created DESC LIMIT 1',user.id,projectId);
        return json({snapshot:row?{id:row.id,created:Number(row.created),payload:JSON.parse(row.payload)}:null});
      }
      if(req.method!=='POST')throw new AccountError(405,'请使用 POST');
      let body;try{body=JSON.parse(await req.text()||'{}')}catch{throw new AccountError(400,'请求格式错误')}
      if(action==='set-project'||action==='set-image'){
        const kind=action==='set-project'?'project':'image';
        const subject=text(body.subjectId,128); if(!subject)throw new AccountError(400,'缺少公开对象');
        const title=text(body.title,200)||'未命名';
        const payload=JSON.stringify(body.payload??{}).slice(0,1500000);
        const existing=await one('SELECT id FROM studio_publications WHERE owner=$1 AND kind=$2 AND subject_id=$3',user.id,kind,subject);
        if(body.public===false){
          if(existing)await q('UPDATE studio_publications SET revoked=true, updated=$2 WHERE id=$1',existing.id,now);
          return json({public:false});
        }
        if(existing)await q('UPDATE studio_publications SET title=$2,payload=$3,revoked=false,updated=$4 WHERE id=$1',existing.id,title,payload,now);
        else await q('INSERT INTO studio_publications (id,owner,kind,subject_id,title,payload,created,updated) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',randomUUID(),user.id,kind,subject,title,payload,now);
        const saved=await one('SELECT id FROM studio_publications WHERE owner=$1 AND kind=$2 AND subject_id=$3 AND revoked=false',user.id,kind,subject);
        return json({public:true,id:saved.id});
      }
      if(action==='snapshot'){
        const projectId=text(body.projectId,128); if(!projectId)throw new AccountError(400,'缺少项目');
        const payload=JSON.stringify(body.payload??{});
        if(payload.length>1500000)throw new AccountError(413,'快照过大');
        const id=randomUUID();
        await q("INSERT INTO studio_project_snapshots (id,owner,project_id,label,payload,created) VALUES ($1,$2,$3,'latest',$4,$5)",id,user.id,projectId,payload,now);
        return json({id},201);
      }
      throw new AccountError(404,'接口不存在');
    }catch(e){
      return json({error:e.status?e.message:'公开服务暂不可用'},e.status||503);
    }
  };
}
