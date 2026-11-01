// Resident Mac executor: one process per Grok account. Each account has its own
// Chrome profile, connection file, and archive folder. Accounts do not share a
// lock or a browser. Config: ~/Library/Application Support/JubaopengGrokMember/config.json
//
// One account (same as before when no label is set):
//   {"connection":"<connection.json>","profileDir":"<Chrome profile>"}
//
// Several accounts. extraOrigins is optional and local — exact https origins, no wildcards:
//   {"extraOrigins":["https://sunny.example"],"accounts":[
//     {"label":"甲","connection":"/path/a.json","profileDir":"/path/profile-a"},
//     {"label":"乙","connection":"/path/b.json","profileDir":"/path/profile-b"}]}
//
// Start.command launches one process per account. A single account can also be
// started with: node worker.mjs config.json --account 甲
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validateConfig, validateExtraOrigins, validateJob, validateDataUrl, loadReference, dataUrlBytes, websiteRequest, pause, retryDelayMs} from '../mac-image-worker/worker.mjs';
import {MemberStop, openProfile, imagineOnce, saveAndCompress} from './executor.mjs';

export const HOME_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JubaopengGrokMember');
// A subfolder: the image-upload watcher imports files at the top level of 剧爆棚出图, which would duplicate these.
export const ARCHIVE_DIR = path.join(os.homedir(), 'Pictures', '剧爆棚出图', '会员出图');
export const ACCOUNT_LABEL = /^[\p{L}\p{N}_-]{1,32}$/u;
const PAUSE_REASONS = new Set(['CAPTCHA', 'LOGIN', 'QUOTA', 'STRUCTURE', 'BUSY']);
const stamp = () => new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});

export function archiveDirFor(label, root = ARCHIVE_DIR) {
  if (!label) return root;
  if (typeof label !== 'string' || !ACCOUNT_LABEL.test(label)) throw Error('账号标签无效');
  return path.join(root, label);
}
export function accountStateDir(label, home = HOME_DIR) {
  if (!label) return home;
  if (typeof label !== 'string' || !ACCOUNT_LABEL.test(label)) throw Error('账号标签无效');
  return path.join(home, 'accounts', label);
}
function absolutePath(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0') && !value.split(path.sep).includes('..') && value.length <= 1024;
}
export function parseMemberSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('会员出图配置无效');
  if (Object.keys(value).some(key => !['connection', 'profileDir', 'extraOrigins', 'accounts'].includes(key))) throw Error('会员出图配置无效');
  const extraOrigins = validateExtraOrigins(value.extraOrigins);
  if (value.accounts != null && (value.connection != null || value.profileDir != null)) throw Error('会员出图配置无效');
  let accounts;
  if (value.accounts != null) {
    if (!Array.isArray(value.accounts) || value.accounts.length < 1 || value.accounts.length > 8) throw Error('会员出图配置无效');
    accounts = value.accounts.map(account => {
      if (!account || typeof account !== 'object' || Array.isArray(account) || Object.keys(account).some(key => !['label', 'connection', 'profileDir'].includes(key))) throw Error('会员出图配置无效');
      if (typeof account.label !== 'string' || !ACCOUNT_LABEL.test(account.label) || !absolutePath(account.connection) || !absolutePath(account.profileDir)) throw Error('会员出图配置无效');
      return {label: account.label, connection: account.connection, profileDir: account.profileDir};
    });
    for (const key of ['label', 'connection', 'profileDir']) {
      if (new Set(accounts.map(account => account[key])).size !== accounts.length) throw Error('会员出图配置无效');
    }
  } else {
    if (!absolutePath(value.connection) || !absolutePath(value.profileDir)) throw Error('会员出图配置无效');
    accounts = [{label: '', connection: value.connection, profileDir: value.profileDir}];
  }
  return {extraOrigins, accounts};
}
export function memberLaunchArgs(settings) {
  return parseMemberSettings(settings).accounts.map(account => ({label: account.label, args: account.label ? ['--account', account.label] : []}));
}
export function launchAgentPlans({settings, node, script, configFile, homeDir = HOME_DIR}) {
  return parseMemberSettings(settings).accounts.map((account, index) => {
    const stateDir = accountStateDir(account.label, homeDir);
    return {
      label: account.label ? `com.jubaopeng.grok-member-worker.${index + 1}` : 'com.jubaopeng.grok-member-worker',
      account: account.label,
      args: [node, script, configFile, ...(account.label ? ['--account', account.label] : [])],
      log: account.label ? path.join(stateDir, 'worker.log') : path.join(homeDir, 'worker.log'),
      stateDir,
    };
  });
}
export function launchAgentPlist(plan) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const args = plan.args.map(arg => `  <string>${escape(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>${escape(plan.label)}</string>
 <key>ProgramArguments</key><array>
${args}
 </array>
 <key>RunAtLoad</key><true/>
 <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
 <key>ThrottleInterval</key><integer>60</integer>
 <key>StandardOutPath</key><string>${escape(plan.log)}</string>
 <key>StandardErrorPath</key><string>${escape(plan.log)}</string>
</dict></plist>
`;
}
/** Starts every account and waits. One account ending does not cancel the others. */
export async function superviseAccounts(plans, spawn) {
  const children = plans.map(plan => spawn(plan));
  return Promise.all(children.map(async (child, index) => {
    try {await child; return {label: plans[index].label, account: plans[index].account, ok: true};}
    catch {return {label: plans[index].label, account: plans[index].account, ok: false};}
  }));
}

/** Maps one attempt to the website completion body. Definite page refusals release quota; unknown ends are UNCERTAIN. */
export function completionFor(error) {
  if (error instanceof MemberStop) {
    const body = {error: error.definite ? 'REJECTED' : 'UNCERTAIN', reason: error.reason};
    if (error.reason === 'STRUCTURE' && error.step) body.step = error.step;
    return body;
  }
  return {error: 'UNCERTAIN', reason: 'PAGE'};
}

export async function materializeReferences(job, {dir, configuration, fetcher, extraOrigins} = {}) {
  const items = [];
  if (job?.source) items.push(job.source);
  for (const ref of job?.references || []) items.push(ref);
  if (!items.length) return {dir: '', files: []};
  const root = dir || await fs.mkdtemp(path.join(os.tmpdir(), 'grok-refs-'));
  await fs.mkdir(root, {recursive: true, mode: 0o700});
  const files = [];
  try {
    for (let index = 0; index < items.length; index++) {
      const loaded = typeof items[index] === 'string' ? dataUrlBytes(items[index]) : await loadReference(configuration, job, items[index], {fetcher, extraOrigins});
      const file = path.join(root, `${index}.${loaded.ext}`);
      await fs.writeFile(file, loaded.bytes, {mode: 0o600});
      files.push(file);
    }
  } catch (error) {
    if (!dir) await fs.rm(root, {recursive: true, force: true}).catch(() => {});
    throw error;
  }
  return {dir: root, files};
}

export async function processJob(job, {chromium, profileDir, archiveDir = ARCHIVE_DIR, configuration, fetcher, extraOrigins, log = console.log, open = openProfile, imagine = imagineOnce, compress = saveAndCompress, materialize = materializeReferences} = {}) {
  if (job?.type === 'video') return {result: {error: 'REJECTED', reason: 'UNSUPPORTED'}, stats: {ms: 0}};
  const started = Date.now(); let context, files;
  try {
    files = await materialize(job, {configuration, fetcher, extraOrigins});
    try {context = await open({chromium, profileDir});}
    catch (error) {if (error instanceof MemberStop) throw error; const e = new MemberStop('PAGE', true); e.step = '启动'; e.detail = '浏览器未能打开'; throw e;}
    const image = await imagine(context, {prompt: job.prompt, ratio: job.ratio, files: files.files, uploadStep: job.type === 'edit' ? '改图' : '上传参考图'}, {log: line => log(`[${stamp()}] ${line}`)});
    const saved = await compress(image.bytes, {id: job.id, archiveDir});
    const dataUrl = validateDataUrl(`data:${saved.mime};base64,${saved.bytes.toString('base64')}`);
    return {result: {dataUrl}, stats: {ms: Date.now() - started, before: saved.before, after: saved.after, file: saved.original}};
  } catch (error) {
    if (error?.kind === 'revoked' || error?.kind === 'expired') throw error;
    if (!(error instanceof MemberStop)) {
      const wrapped = new MemberStop('PAGE', error?.definite !== false && error?.kind !== 'temporary');
      wrapped.step = error?.step || '';
      wrapped.detail = error?.kind === 'temporary' ? '参考图下载未完成' : '参考图未能准备';
      error = wrapped;
    }
    log(`[${stamp()}] 任务失败：${error.reason}${error.detail ? '（' + error.detail + '）' : ''}${error.step ? '，卡在步骤：' + error.step : ''}`);
    return {result: completionFor(error), stats: {ms: Date.now() - started, ...(error.step ? {step: error.step} : {}), ...(error.detail ? {detail: error.detail} : {})}};
  } finally {
    await context?.close().catch(() => {});
    if (files?.dir) await fs.rm(files.dir, {recursive: true, force: true}).catch(() => {});
  }
}

export async function startMemberWorker({configFile = path.join(HOME_DIR, 'config.json'), account: accountLabel = '', chromium, log = console.log, pollMs = 10000, sleep = pause, random = Math.random, transport = websiteRequest, homeDir = HOME_DIR, archiveRoot = ARCHIVE_DIR, runJob = processJob} = {}) {
  const settings = parseMemberSettings(JSON.parse(await fs.readFile(configFile, 'utf8')));
  const account = accountLabel ? settings.accounts.find(item => item.label === accountLabel) : settings.accounts.length === 1 ? settings.accounts[0] : null;
  if (!account) throw Error(accountLabel ? '账号标签无效' : '请用 --account 指定其中一个账号');
  const connection = validateConfig(JSON.parse(await fs.readFile(account.connection, 'utf8')), {extraOrigins: settings.extraOrigins});
  await fs.access(account.profileDir);
  const stateDir = accountStateDir(account.label, homeDir);
  await fs.mkdir(stateDir, {recursive: true, mode: 0o700});
  const lockPath = path.join(stateDir, 'worker.lock');
  let lockHandle;
  try {lockHandle = await fs.open(lockPath, 'wx', 0o600); await lockHandle.writeFile(String(process.pid));}
  catch {throw Error(account.label ? `账号 ${account.label} 的出图端已在运行` : '会员出图端已在运行');}
  const intents = path.join(stateDir, 'intents'); await fs.mkdir(intents, {recursive: true, mode: 0o700});
  const statsFile = path.join(stateDir, 'runs.jsonl');
  const archiveDir = archiveDirFor(account.label, archiveRoot);
  const request = (action, body = {}) => transport(connection, action, body, {extraOrigins: settings.extraOrigins});
  const identity = account.label ? {accountLabel: account.label, workerId: connection.workerId} : {};
  let stopped = false; const stop = () => {stopped = true;};
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const beat = setInterval(() => request('heartbeat').catch(() => {}), 15000);
  try {
    // A job interrupted mid-page is never run again; it is reported as uncertain.
    for (const file of await fs.readdir(intents)) {
      if (!file.endsWith('.json')) continue;
      const intent = JSON.parse(await fs.readFile(path.join(intents, file), 'utf8'));
      await request('complete', {id: intent.id, lease: intent.lease, error: 'UNCERTAIN', reason: 'TIMEOUT', ...identity}).catch(() => {});
      await fs.unlink(path.join(intents, file));
    }
    await request('heartbeat');
    log(`[${stamp()}] 会员出图端已连接${account.label ? '（账号 ' + account.label + '）' : ''}，等待任务`);
    let streak = 0;
    while (!stopped) {
      try {
        const {job: raw} = await request('poll');
        streak = 0;
        if (raw) {
          const job = validateJob(raw), intent = path.join(intents, job.id + '.json');
          await fs.writeFile(intent, JSON.stringify({id: job.id, lease: job.lease}), {mode: 0o600});
          log(`[${stamp()}] 领取任务 ${job.id}${account.label ? '（账号 ' + account.label + '）' : ''}`);
          const outcome = job.type === 'video'
            ? {result: {error: 'REJECTED', reason: 'UNSUPPORTED'}, stats: {ms: 0}}
            : await runJob(job, {chromium, profileDir: account.profileDir, archiveDir, configuration: connection, extraOrigins: settings.extraOrigins, log});
          const {result, stats} = outcome;
          const response = await request('complete', {id: job.id, lease: job.lease, ...identity, ...result});
          await fs.unlink(intent).catch(() => {});
          await fs.appendFile(statsFile, JSON.stringify({id: job.id, at: Date.now(), account: account.label, status: response?.status, reason: result.reason || '', ...stats}) + '\n');
          log(`[${stamp()}] 任务 ${job.id} → ${response?.status}${result.reason ? '（' + result.reason + '）' : ''}`);
          if (PAUSE_REASONS.has(result.reason)) {
            log(`[${stamp()}] 账号已暂停（${result.reason}）。请处理后再启动，不会自动领取下一张。`);
            return {paused: result.reason};
          }
          await sleep(15000 + Math.floor(Math.min(1, Math.max(0, Number(random()) || 0)) * 10000));
          continue;
        }
      } catch (error) {
        log(`[${stamp()}] 连接异常：${error?.type || '网络'}，HTTP ${Number.isInteger(error?.status) ? error.status : '—'}（${error?.kind || 'temporary'}）`);
        if (error?.kind === 'revoked') break;
        await sleep(retryDelayMs(streak, random));
        streak++;
        continue;
      }
      await sleep(pollMs);
    }
  } finally {
    clearInterval(beat);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await lockHandle?.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}

function selectedAccount(argv) {
  const args = argv.slice(2);
  const index = args.indexOf('--account');
  const account = index >= 0 ? args[index + 1] || '' : '';
  const configFile = args.find((arg, position) => arg !== '--account' && position !== index + 1 && !arg.startsWith('--'));
  return {configFile, account};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const require = createRequire(import.meta.url);
  const {chromium} = require('playwright-core');
  const {configFile, account} = selectedAccount(process.argv);
  startMemberWorker({chromium, configFile, account}).catch(error => {console.error(`[${stamp()}] 已停止：${error?.message || error}`); process.exit(1);});
}
