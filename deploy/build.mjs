import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('public',{recursive:true});
for(const file of await fs.readdir('../pages'))if(!file.startsWith('.')&&file!=='README.md')await fs.cp(path.join('../pages',file),path.join('public',file),{recursive:true});
const index=await fs.readFile('public/index.html','utf8');
await fs.writeFile('public/index.html',index.replace('<head>','<head><meta name="studio-account-service" content="enabled">'));

const app=await fs.readFile('public/app.mjs','utf8');
await fs.writeFile('public/app.mjs',app.replace('● GitHub Pages 工作台','● 剧爆棚账户工作台'));
