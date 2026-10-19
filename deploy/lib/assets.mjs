import {AccountError,hash,cookie,safeOrigin,requireAdmin} from './security.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function text(value,max,label){if(typeof value!=='string'||value.length>max)throw new AccountError(400,label+'无效');return value;}
function identifier(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))throw new AccountError(400,'记录标识无效');return value;}
function mediaUrl(value){if(!value)return '';let u;try{u=new URL(value)}catch{throw new AccountError(400,'媒体地址无效')}
 if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||u.hostname.endsWith('.local')||value.length>4096)throw new AccountError(400,'媒体地址无效');return u.href;}
export function createAssetHandler(query){return async req=>{try{
 safeOrigin(req);const url=new URL(req.url),action=url.searchParams.get('action')||'list',now=Date.now();
 const q=(sql,...params)=>query(sql,params),one=async(sql,...params)=>(await q(sql,...params))[0];
 const raw=cookie(req),user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),now):null;
 if(!user)throw new AccountError(401,'请先使用手机号登录');
 if(action==='sync'){
  if(req.method!=='POST')throw new AccountError(405,'请使用 POST');const rawBody=await req.text();if(Buffer.byteLength(rawBody)>1000000)throw new AccountError(413,'同步内容过大');let b;try{b=JSON.parse(rawBody)}catch{throw new AccountError(400,'请求格式错误')}
  if(!b||typeof b!=='object'||b.accountId!==user.id)throw new AccountError(409,'账号已切换，请重新同步当前账号资产');
  const projectId=identifier(b.projectId),projectTitle=text(b.projectTitle,200,'项目名称');if(!Array.isArray(b.assets)||b.assets.length>20)throw new AccountError(400,'每次最多同步20个资产');
  const rows=b.assets.map(a=>{
   if(!a||!['image','video','audio'].includes(a.kind)||!['local','bound-result'].includes(a.provenance))throw new AccountError(400,'资产类型无效');
   const preview=text(a.preview||'',50000,'预览');if(preview&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(preview))throw new AccountError(400,'仅允许图片预览');
   const created=Number(a.created);if(!Number.isSafeInteger(created)||created<0||created>now+86400000)throw new AccountError(400,'创建时间无效');
   return [user.id,projectId,identifier(a.id),projectTitle,text(a.name,300,'资产名称'),a.kind,a.provenance,text(a.prompt||'',8000,'提示词'),preview,mediaUrl(a.mediaUrl),created,now];
  });
  if(new Set(rows.map(r=>r[2])).size!==rows.length)throw new AccountError(400,'同批次资产标识重复');
  if(rows.length){const params=rows.flat(),values=rows.map((row,i)=>'('+row.map((_,j)=>'$'+(i*12+j+1)).join(',')+')').join(',');
   await query('INSERT INTO studio_asset_records (owner,project_id,asset_id,project_title,name,kind,provenance,prompt,preview,media_url,created,synced) VALUES '+values+' ON CONFLICT(owner,project_id,asset_id) DO UPDATE SET project_title=excluded.project_title,name=excluded.name,provenance=excluded.provenance,prompt=excluded.prompt,preview=excluded.preview,media_url=excluded.media_url,synced=excluded.synced',params);
  }
  return json({synced:rows.length});
 }
 requireAdmin(user);if(req.method!=='GET')throw new AccountError(405,'请使用 GET');
 if(action==='list'){
  const owner=url.searchParams.get('owner')||'',kind=url.searchParams.get('kind')||'',search=url.searchParams.get('search')||'';
  if(owner)identifier(owner);if(kind&&!['image','video','audio','text'].includes(kind))throw new AccountError(400,'资产类型无效');if(search.length>100)throw new AccountError(400,'搜索内容过长');
  const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)throw new AccountError(400,'页码无效');
  const source=`(SELECT 'asset' AS source,r.asset_id AS id,r.owner,r.project_id,r.project_title,r.name,r.kind,r.provenance,r.prompt,r.preview,r.media_url,'' AS result,'' AS error,'done' AS status,r.created,r.synced AS updated FROM studio_asset_records r UNION ALL SELECT 'job' AS source,j.id,j.owner,'' AS project_id,'文字生成' AS project_title,'文字生成任务' AS name,'text' AS kind,'generated' AS provenance,j.prompt,'' AS preview,'' AS media_url,j.result,j.error,j.status,j.created,j.updated FROM studio_generation_jobs j) v JOIN studio_accounts a ON a.id=v.owner`;
  const where=" WHERE ($1='' OR v.owner=$1) AND ($2='' OR v.kind=$2) AND ($3='' OR lower(a.name||' '||a.phone||' '||v.name||' '||v.project_title||' '||v.prompt) LIKE $3 ESCAPE '!')";
  const term=search?'%'+search.toLowerCase().replace(/[!%_]/g,c=>'!'+c)+'%':'';
  const count=await one('SELECT count(*) AS n FROM '+source+where,owner,kind,term);
  const rows=await q('SELECT v.*,a.name AS owner_name,a.phone AS owner_phone FROM '+source+where+' ORDER BY v.created DESC,v.owner,v.source,v.project_id,v.id LIMIT 24 OFFSET $4',owner,kind,term,(page-1)*24);
  const accounts=await q('SELECT id,name,phone,active FROM studio_accounts ORDER BY name,id');
  // Never return credentials, worker leases or underlying provider accounts.
  return json({items:rows.map(r=>({...r,created:Number(r.created),updated:Number(r.updated)})),accounts,total:Number(count.n),page,pageSize:24});
 }
 throw new AccountError(404,'资产接口不存在');
 }catch(e){if(!e.status)console.error('asset-service',e.code||e.name);return json({error:e.status?e.message:'资产记录暂不可用，请稍后刷新'},e.status||503)}};}
