// 导出 /bench 静态副本。同源正式版不跑这个脚本。预览站由用户自己发布。
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'bench-export');
await fs.rm(out, {recursive: true, force: true});
await fs.cp(path.join(root, 'pages'), out, {recursive: true, filter: src => !src.endsWith('README.md') && !src.endsWith('.nojekyll')});
const indexPath = path.join(out, 'index.html');
let index = await fs.readFile(indexPath, 'utf8');
const meta = [
  '<meta name="studio-account-service" content="enabled">',
  '<meta name="studio-api-base" content="https://jubaopeng-canvas.vercel.app">',
  '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\' https://jubaopeng-canvas.vercel.app">',
].join('');
if (!index.includes('studio-api-base')) index = index.replace('<head>', '<head>' + meta);
index = index.replace('GitHub Pages 不提供后端', '已接入正式版后台');
await fs.writeFile(indexPath, index);
await fs.writeFile(path.join(out, 'README.md'), `这是给 https://zinc-raven-rocket-drift.grok.me/bench/ 用的静态导出。\n登录按钮在接上正式版后台后显示「登录正式版账号」。\n令牌只放 sessionStorage 的 jbp-bench-token，不进项目 JSON。\n把本目录交给预览项目发布，不要手改文件名。\n`);
console.log('已导出 bench-export/');
