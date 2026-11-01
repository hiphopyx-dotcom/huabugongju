import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('public',{recursive:true});
for(const file of await fs.readdir('../pages'))if(!file.startsWith('.')&&file!=='README.md')await fs.cp(path.join('../pages',file),path.join('public',file),{recursive:true});
// Production uses deploy/ as the Vercel root; publish the separately maintained
// studio application to /studio/ as well as the legacy root workstation.
// Without this copy, /studio/ returns HTTP 404 although the deployment is READY.
await fs.cp('../public/studio','public/studio',{recursive:true});
for (const required of ['index.html','app.mjs','image-workshop.mjs','canvas-ui.mjs','canvas-workspace.css']) {
  await fs.access(path.join('public','studio',required));
}
// Only the Vercel account edition may enable the authenticated API UI.
// Leave the shared public/studio source usable in unauthenticated previews.
const studioIndex=path.join('public','studio','index.html');
const studioHTML=await fs.readFile(studioIndex,'utf8');
await fs.writeFile(studioIndex,studioHTML.replace('<head>','<head><meta name="studio-account-service" content="enabled">'));

const index=await fs.readFile('public/index.html','utf8');
await fs.writeFile('public/index.html',index.replace('<head>','<head><meta name="studio-account-service" content="enabled">'));

const app=await fs.readFile('public/app.mjs','utf8');
await fs.writeFile('public/app.mjs',app.replace('● GitHub Pages 工作台','● 剧爆棚账户工作台'));
