// 导出 /bench 静态副本。同源正式版不跑这个脚本。预览站由用户自己发布。
// 写出后立刻做语法检查和静态导入解析，模块对不上就失败，避免预览页停在「正在载入项目」。
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);

if (!process.execArgv.includes('--experimental-vm-modules')) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', scriptPath, ...process.argv.slice(2)], {stdio: 'inherit', cwd: root});
  process.exit(child.status === null ? 1 : child.status);
}

function commitVersion() {
  const result = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: root, encoding: 'utf8'});
  const sha = (result.stdout || '').trim();
  if (result.status !== 0 || !/^[0-9a-f]{7,40}$/.test(sha)) throw Error('无法从 git 读取导出版本号，已停止导出');
  return sha;
}

function stampVersion(source, version) {
  return source
    .replace(/(from\s+['"](?:\.\.?\/)[^'"?\s]+)\?v=[A-Za-z0-9._-]+/g, `$1?v=${version}`)
    .replace(/(import\(\s*['"](?:\.\.?\/)[^'"?\s]+)\?v=[A-Za-z0-9._-]+/g, `$1?v=${version}`)
    .replace(/(\b(?:src|href)=["'][^"']+?)\?v=[A-Za-z0-9._-]+/g, `$1?v=${version}`);
}

function versionTokens(source) {
  const found = [];
  const patterns = [
    /from\s+['"][^'"]+\?v=([A-Za-z0-9._-]+)/g,
    /import\(\s*['"][^'"]+\?v=([A-Za-z0-9._-]+)/g,
    /(?:src|href)=["'][^"']+\?v=([A-Za-z0-9._-]+)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function localRef(spec) {
  const clean = spec.split(/[?#]/)[0];
  if (!clean || clean.startsWith('#') || clean.startsWith('//') || clean.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return '';
  return clean;
}

async function linkModules(out, files) {
  const context = vm.createContext({});
  const modules = new Map();
  const external = new Map();
  function make(file) {
    const id = pathToFileURL(path.resolve(file)).href;
    if (modules.has(id)) return modules.get(id);
    let mod;
    try {
      mod = new vm.SourceTextModule(fsSync.readFileSync(file, 'utf8'), {
        identifier: id,
        context,
        initializeImportMeta(meta) { meta.url = id; },
      });
    } catch (error) {
      throw Error(`${path.relative(out, file)} 无法解析：${String(error.message || error).split('\n')[0]}`);
    }
    modules.set(id, mod);
    return mod;
  }
  function externalModule(specifier) {
    if (!external.has(specifier)) external.set(specifier, new vm.SourceTextModule('export {}', {identifier: `external:${specifier}`, context}));
    return external.get(specifier);
  }
  const linker = async (specifier, referencing) => {
    const clean = localRef(specifier);
    if (!clean.startsWith('.')) return externalModule(specifier);
    const file = decodeURIComponent(new URL(clean, referencing.identifier).pathname);
    if (!fsSync.existsSync(file)) throw Error(`${path.relative(out, fileURLToPath(referencing.identifier))} 引用了不存在的 ${specifier}`);
    return make(file);
  };
  const failures = [];
  for (const file of files) {
    const mod = make(file);
    if (mod.status !== 'unlinked') continue;
    try { await mod.link(linker); }
    catch (error) { failures.push(`${path.relative(out, file)}：${String(error.message || error).split('\n')[0]}`); }
  }
  if (failures.length) throw Error(failures.join('\n'));
}

async function verifyExport(out) {
  const files = await walk(out);
  const modules = files.filter(file => file.endsWith('.mjs') || file.endsWith('.js'));
  const problems = [];
  for (const file of modules) {
    const check = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    if (check.status !== 0) problems.push(`${path.relative(out, file)} 语法错误\n${(check.stderr || '').trim()}`);
  }
  for (const file of files.filter(name => name.endsWith('.html'))) {
    const html = await fs.readFile(file, 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const ref = localRef(match[1]);
      if (!ref) continue;
      if (!fsSync.existsSync(path.resolve(path.dirname(file), ref))) problems.push(`${path.relative(out, file)} 引用了不存在的 ${match[1]}`);
    }
  }
  for (const file of modules) {
    const code = await fs.readFile(file, 'utf8');
    for (const match of code.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const ref = localRef(match[1]);
      if (!fsSync.existsSync(path.resolve(path.dirname(file), ref))) problems.push(`${path.relative(out, file)} 动态导入了不存在的 ${match[1]}`);
    }
  }
  if (!problems.length) {
    try { await linkModules(out, modules); }
    catch (error) { problems.push(error.message); }
  }
  if (problems.length) throw Error('bench 导出无法加载：\n' + problems.join('\n'));
}

const version = commitVersion();
const out = path.join(root, 'bench-export');
await fs.rm(out, {recursive: true, force: true});
await fs.cp(path.join(root, 'pages'), out, {recursive: true, filter: src => !src.endsWith('README.md') && !src.endsWith('.nojekyll')});
const textExt = new Set(['.mjs', '.js', '.html', '.css']);
for (const file of await walk(out)) {
  if (!textExt.has(path.extname(file))) continue;
  const source = await fs.readFile(file, 'utf8');
  const stamped = stampVersion(source, version);
  if (stamped !== source) await fs.writeFile(file, stamped);
}
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
await fs.writeFile(path.join(out, 'README.md'), `这是给 https://zinc-raven-rocket-drift.grok.me/bench/ 用的静态导出。\n登录按钮在接上正式版后台后显示「登录正式版账号」。\n令牌只放 sessionStorage 的 jbp-bench-token，不进项目 JSON。\n把本目录交给预览项目发布，不要手改文件名。\n资源版本号是导出时的提交 ${version}。\n`);
await verifyExport(out);
const stale = [];
for (const file of await walk(out)) {
  if (!textExt.has(path.extname(file))) continue;
  const source = await fs.readFile(file, 'utf8');
  for (const token of versionTokens(source)) if (token !== version) stale.push(`${path.relative(out, file)} 仍使用 ?v=${token}`);
}
if (stale.length) throw Error('导出版本号没有全部换成当前提交：\n' + [...new Set(stale)].join('\n'));
console.log(`已导出 bench-export/ （?v=${version}）`);
