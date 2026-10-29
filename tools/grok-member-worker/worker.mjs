// Resident Mac executor: claims one website job at a time and runs it in the
// member's own grok.com session. Config: ~/Library/Application Support/JubaopengGrokMember/config.json
//   {"connection": "<path to connection.json from the site admin>", "profileDir": "<member Chrome profile>"}
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validateConfig, validateJob, validateDataUrl, websiteRequest, pause} from '../mac-image-worker/worker.mjs';
import {MemberStop, openProfile, imagineOnce, saveAndCompress} from './executor.mjs';

export const HOME_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JubaopengGrokMember');
// A subfolder: the image-upload watcher imports files at the top level of 剧爆棚出图, which would duplicate these.
export const ARCHIVE_DIR = path.join(os.homedir(), 'Pictures', '剧爆棚出图', '会员出图');
const stamp = () => new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});

/** Maps one attempt to the website completion body. Definite page refusals release quota; unknown ends are UNCERTAIN. */
export function completionFor(error) {
  if (error instanceof MemberStop) return {error: error.definite ? 'REJECTED' : 'UNCERTAIN', reason: error.reason};
  return {error: 'UNCERTAIN', reason: 'PAGE'};
}

export async function processJob(job, {chromium, profileDir, archiveDir = ARCHIVE_DIR, log = console.log, open = openProfile, imagine = imagineOnce, compress = saveAndCompress}) {
  if (job.references.length) return {result: {error: 'REJECTED', reason: 'PAGE'}};
  const started = Date.now(); let context;
  try {
    context = await open({chromium, profileDir});
    const image = await imagine(context, job, {log: line => log(`[${stamp()}] ${line}`)});
    const saved = await compress(image.bytes, {id: job.id, archiveDir});
    const dataUrl = validateDataUrl(`data:${saved.mime};base64,${saved.bytes.toString('base64')}`);
    return {result: {dataUrl}, stats: {ms: Date.now() - started, before: saved.before, after: saved.after, file: saved.original}};
  } catch (error) {
    log(`[${stamp()}] 任务失败：${error instanceof MemberStop ? error.reason : '页面异常'}${error?.step ? '，卡在步骤：' + error.step : ''}`);
    return {result: completionFor(error), stats: {ms: Date.now() - started, ...(error?.step ? {step: error.step} : {})}};
  } finally {await context?.close().catch(() => {});}
}

export async function startMemberWorker({configFile = path.join(HOME_DIR, 'config.json'), chromium, log = console.log, pollMs = 10000} = {}) {
  const settings = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const connection = validateConfig(JSON.parse(await fs.readFile(settings.connection, 'utf8')));
  const profileDir = settings.profileDir;
  await fs.access(profileDir);
  const intents = path.join(HOME_DIR, 'intents'); await fs.mkdir(intents, {recursive: true, mode: 0o700});
  const statsFile = path.join(HOME_DIR, 'runs.jsonl');
  const request = (action, body = {}) => websiteRequest(connection, action, body);
  // A job interrupted mid-page is never run again; it is reported as uncertain.
  for (const file of await fs.readdir(intents)) {
    const intent = JSON.parse(await fs.readFile(path.join(intents, file), 'utf8'));
    await request('complete', {id: intent.id, lease: intent.lease, error: 'UNCERTAIN', reason: 'TIMEOUT'}).catch(() => {});
    await fs.unlink(path.join(intents, file));
  }
  let stopped = false; const stop = () => {stopped = true;};
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const beat = setInterval(() => request('heartbeat').catch(() => {}), 15000);
  await request('heartbeat');
  log(`[${stamp()}] 会员出图端已连接，等待任务`);
  try {
    while (!stopped) {
      try {
        const {job: raw} = await request('poll');
        if (raw) {
          const job = validateJob(raw), intent = path.join(intents, job.id + '.json');
          await fs.writeFile(intent, JSON.stringify({id: job.id, lease: job.lease}), {mode: 0o600});
          log(`[${stamp()}] 领取任务 ${job.id}`);
          const {result, stats} = await processJob(job, {chromium, profileDir, log});
          const response = await request('complete', {id: job.id, lease: job.lease, ...result});
          await fs.unlink(intent).catch(() => {});
          await fs.appendFile(statsFile, JSON.stringify({id: job.id, at: Date.now(), status: response?.status, reason: result.reason || '', ...stats}) + '\n');
          log(`[${stamp()}] 任务 ${job.id} → ${response?.status}${result.reason ? '（' + result.reason + '）' : ''}`);
          await pause(15000 + Math.random() * 10000);
          continue;
        }
      } catch (error) {
        log(`[${stamp()}] 连接异常：${error?.kind || 'temporary'}（${String(error?.status || '')} ${String(error?.message || error).slice(0, 200)}）`);
        if (error?.kind === 'revoked') break;
      }
      await pause(pollMs);
    }
  } finally {clearInterval(beat);}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const require = createRequire(import.meta.url);
  const {chromium} = require('playwright-core');
  startMemberWorker({chromium, configFile: process.argv[2]}).catch(error => {console.error(`[${stamp()}] 已停止：${error?.message || error}`); process.exit(1);});
}
