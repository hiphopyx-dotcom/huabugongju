import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source,'../..');
const output = process.argv[2] && path.resolve(process.argv[2]);
if(!output || output === root || !path.isAbsolute(output)) throw Error('Pass a new absolute output directory');
await fs.mkdir(output,{recursive:false});
const staticDir = path.join(output,'public');
await fs.mkdir(staticDir);
for(const name of await fs.readdir(path.join(root,'pages'))) {
  if(name.startsWith('.') || name === 'README.md') continue;
  await fs.cp(path.join(root,'pages',name),path.join(staticDir,name),{recursive:true});
}
const index = await fs.readFile(path.join(staticDir,'index.html'),'utf8');
await fs.writeFile(path.join(staticDir,'index.html'),index.replace('<head>','<head><meta name="studio-account-service" content="enabled">'));
const app = await fs.readFile(path.join(staticDir,'app.mjs'),'utf8');
await fs.writeFile(path.join(staticDir,'app.mjs'),app.replace('● GitHub Pages 工作台','● 剧爆棚账户工作台'));
const files = [];
async function walk(dir,prefix='') {
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    if(entry.name.startsWith('.')) continue;
    const name = prefix + entry.name;
    if(entry.isDirectory()) await walk(path.join(dir,entry.name),name + '/');
    else files.push(name);
  }
}
await walk(staticDir);
const digest = createHash('sha256');
for(const name of files.sort()) digest.update(name).update(await fs.readFile(path.join(staticDir,name)));
const release = {format:'jbp-cloudbase-release-v1',sourceCommit:process.env.JBP_SOURCE_COMMIT || '',
  builtAt:new Date().toISOString(),contentHash:digest.digest('hex')};
await fs.writeFile(path.join(staticDir,'release.json'),JSON.stringify(release));
await fs.writeFile(path.join(staticDir,'manifest.json'),JSON.stringify([...files,'release.json']));
await fs.mkdir(path.join(output,'deploy'));
await fs.cp(path.join(root,'deploy/lib'),path.join(output,'deploy/lib'),{recursive:true});
await fs.mkdir(path.join(staticDir,'studio'));
for(const name of ['core.mjs','collab-core.mjs','model-privacy.mjs','token-estimate.mjs'])
  await fs.copyFile(path.join(root,'public/studio',name),path.join(staticDir,'studio',name));
for(const name of ['server.mjs','backend.mjs','relay.mjs','scf_bootstrap'])
  await fs.copyFile(path.join(source,name),path.join(output,name));
await fs.chmod(path.join(output,'scf_bootstrap'),0o755);
// The locked production dependency is pure JavaScript, with no runtime dependencies.
const dependency = path.join(root,'deploy/node_modules/@neondatabase/serverless');
const info = JSON.parse(await fs.readFile(path.join(dependency,'package.json'),'utf8'));
if(Object.keys(info.dependencies || {}).length) throw Error('Dependency closure needs review');
await fs.mkdir(path.join(output,'node_modules/@neondatabase'),{recursive:true});
await fs.cp(dependency,path.join(output,'node_modules/@neondatabase/serverless'),{recursive:true});
await fs.writeFile(path.join(output,'package.json'),JSON.stringify({name:'jbp-workbench',private:true,type:'module',
  engines:{node:'>=20.19'},dependencies:{'@neondatabase/serverless':info.version}}));
console.log(JSON.stringify({output,release,publicFiles:files.length}));
