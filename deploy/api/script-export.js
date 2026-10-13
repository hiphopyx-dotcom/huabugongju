import {neon} from '@neondatabase/serverless';
import {Document,HeadingLevel,Packer,Paragraph,TextRun} from 'docx';
import {cookie,hash,requireAdmin,safeOrigin,AccountError} from '../lib/security.mjs';
const err=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
const lineParagraph=(s,heading=false)=>new Paragraph({
 heading:heading?HeadingLevel.HEADING_2:undefined,
 children:[new TextRun({text:s||' ',font:'宋体',size:24,bold:heading||/^\s*\d+[-－]\d+\s/.test(s)})],
 spacing:{line:360,after:heading?180:0},
});
async function handler(req){
 try{
  safeOrigin(req);
  if(req.method!=='POST')throw new AccountError(405,'仅支持 POST');
  if(!process.env.DATABASE_URL)throw new AccountError(503,'账户数据库未配置');
  const raw=cookie(req),query=neon(process.env.DATABASE_URL);
  const users=raw?await query.query('SELECT a.id,a.role FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND s.version=a.session_version AND a.active=true',[hash(raw),Date.now()]):[];
  requireAdmin(users[0]);
  const source=await req.text();
  if(source.length>700000)throw new AccountError(413,'剧本过大，无法一次导出');
  let b;try{b=JSON.parse(source)}catch{throw new AccountError(400,'请求格式无效')}
  const title=String(b.title||'剧本').slice(0,120),context=String(b.context||'').slice(0,200000),script=String(b.script||'').slice(0,500000);
  if(!script.trim())throw new AccountError(400,'暂无剧本正文');
  const children=[new Paragraph({children:[new TextRun({text:title,font:'宋体',size:36,bold:true})],heading:HeadingLevel.TITLE,spacing:{after:300}})];
  if(context.trim()){
   children.push(new Paragraph({children:[new TextRun({text:'故事大纲 / 分集集纲 / 人物设定（项目提供）',font:'宋体',bold:true,size:28})],heading:HeadingLevel.HEADING_1}));
   for(const line of context.replace(/\r\n/g,'\n').split('\n'))children.push(lineParagraph(line));
  }
  children.push(new Paragraph({children:[new TextRun({text:'分集剧本正文',font:'宋体',size:28,bold:true})],heading:HeadingLevel.HEADING_1,spacing:{before:240,after:100}}));
  for(const line of script.replace(/\r\n/g,'\n').split('\n'))children.push(lineParagraph(line,/^\s*第\s*[零一二三四五六七八九十百千\d]+\s*集/.test(line)));
  const doc=new Document({sections:[{properties:{page:{margin:{top:1200,right:1300,bottom:1200,left:1300}}},children}]});
  const buffer=await Packer.toBuffer(doc);
  return new Response(buffer,{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'attachment; filename="jubaopeng-script.docx"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){if(!e.status)console.error('script-export',e.name||'unknown');return err(e.status?e.message:'Word 导出失败',e.status||503)}
}
export {handler as POST};
