// Drives the member's own logged-in grok.com/imagine page like a person would:
// one job at a time, normal clicks and typing only. It never reads cookies or
// tokens, never calls private endpoints, and never tries to get past a captcha.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
export const IMAGINE_URL = 'https://grok.com/imagine';
export const IMAGE_BYTES = 3 * 1024 * 1024;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** A page outcome that must be reported, never retried. */
export class MemberStop extends Error {
  constructor(reason, definite = true) {super(reason); this.reason = reason; this.definite = definite;}
}
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const humanPause = (page, a = 700, b = 1800) => page.waitForTimeout(rand(a, b));

/** Chrome writes SingletonLock -> "<host>-<pid>"; a live pid means another Chrome owns the profile. */
export async function profileOwner(profileDir, {readlink = fs.readlink, alive = pidAlive} = {}) {
  let target;
  try {target = await readlink(path.join(profileDir, 'SingletonLock'));} catch {return null;}
  const pid = Number(/-(\d+)$/.exec(target)?.[1]);
  return pid && alive(pid) ? pid : null;
}
function pidAlive(pid) {try {process.kill(pid, 0); return true;} catch (e) {return e.code === 'EPERM';}}

/** Reads only what is visible on the page and maps it to a fixed reason code. */
export function classifyPageText(text, url = '') {
  const t = String(text || '');
  if (/\/(sign-?in|login)/i.test(url)) return 'LOGIN';
  if (/verify (you are|that you are) (a )?human|人机验证|are you a robot|captcha|请完成安全验证/i.test(t)) return 'CAPTCHA';
  if (/rate limit|limit reached|reached (your|the) (daily |usage )?limit|out of (credits|quota)|upgrade to (supergrok|premium)|额度已用|已达到.{0,8}(上限|限制)|次数已用完|too many requests/i.test(t)) return 'QUOTA';
  if (/moderat|content polic|violat|can'?t (generate|create) (this|that)|unable to generate|无法生成|违反|不符合.{0,6}(政策|规范)/i.test(t)) return 'CONTENT';
  return null;
}

async function visible(locator) {
  const n = await locator.count().catch(() => 0);
  for (let i = 0; i < n; i++) {const item = locator.nth(i); if (await item.isVisible().catch(() => false)) return item;}
  return null;
}
/** Waits like a person for a control to show up instead of judging a half-loaded page. */
async function waitVisible(page, make, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {const hit = await visible(make()); if (hit || Date.now() > end) return hit; await page.waitForTimeout(500);}
}
/**
 * Clicks 提交 once for the typed prompt. If the button is missing or not ready it waits for the page
 * to settle and checks once more; it never retypes, reloads, or clicks twice. Fails with a specific stall.
 */
export async function submitWithRecheck({find, enabled, hasText, click, responded, settle, log = () => {}}) {
  let detail = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const btn = await find(attempt === 1 ? 10000 : 15000);
    if (!btn) detail = '没找到提交按钮';
    else if (!await hasText()) detail = '输入框没有内容';
    else if (!await enabled(btn)) detail = '提交按钮不可点';
    else {
      await click(btn);
      if (await responded()) return attempt;
      // A click that may have reached Grok is never repeated (no double spend); the result is left for review.
      log('提交未成功（点了提交无响应）');
      const e = new MemberStop('SUBMIT', false); e.detail = '点了提交无响应'; throw e;
    }
    log(`提交未成功（${detail}），第 ${attempt} 次`);
    if (attempt === 1) await settle();
  }
  const e = new MemberStop('SUBMIT', true); e.detail = detail; throw e;
}
/** grok.com/imagine offers 2:3, 3:2, 1:1, 9:16, 16:9; the workbench also offers 3:4 and 4:3. */
export const GROK_RATIOS = ['2:3', '3:2', '1:1', '9:16', '16:9'];
export function grokRatio(ratio) {
  if (!ratio || GROK_RATIOS.includes(ratio)) return ratio || '';
  const [w, h] = String(ratio).split(':').map(Number);
  if (!(w > 0 && h > 0)) return '';
  const want = Math.log(w / h);
  return GROK_RATIOS.map(r => [r, Math.abs(Math.log(Number(r.split(':')[0]) / Number(r.split(':')[1])) - want)]).sort((a, b) => a[1] - b[1])[0][0];
}
/** The prompt box is a role=textbox editor labelled 「向 Grok 提任何问题」 on the logged-in page. */
export const PROMPT_BOX = /向 Grok 提任何问题|Ask Grok anything|Ask anything|描述|Describe/i;
export const IMAGE_MODE = /^(图片|Image)$/;
export const SUBMIT = /^(提交|Submit|发送|Send)$/i;
export const STEPS = ['打开页面', '切图片', '选宽高比', '找输入框', '输入', '提交', '等图', '下载'];
async function stopIfBlocked(page) {
  if (await visible(page.locator('iframe[src*="challenges.cloudflare.com"], iframe[title*="challenge" i], iframe[src*="captcha" i]'))) throw new MemberStop('CAPTCHA');
  if (await visible(page.getByRole('button', {name: /^(登录|sign in|log in)$/i})) || await visible(page.getByRole('link', {name: /^(登录|sign in|log in)$/i}))) throw new MemberStop('LOGIN');
  const reason = classifyPageText(await page.evaluate(() => document.body?.innerText || '').catch(() => ''), page.url());
  if (reason) throw new MemberStop(reason);
}

export async function openProfile({chromium, profileDir}) {
  const owner = await profileOwner(profileDir);
  if (owner) throw new MemberStop('BUSY');
  try {
    return await chromium.launchPersistentContext(profileDir, {
      executablePath: CHROME, headless: false, viewport: null, acceptDownloads: true,
      // Use the real macOS keychain so Chrome can read the member's saved grok.com sign-in.
      ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
      args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
    });
  } catch (error) {
    if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(String(error?.message))) throw new MemberStop('BUSY');
    throw error;
  }
}

/** Runs one prompt on grok.com/imagine and returns the original image bytes. */
export async function imagineOnce(context, {prompt, ratio}, {timeoutMs = 240000, log = () => {}, dryRun = false} = {}) {
  let current = '', submitted = false;
  const step = name => {current = name; log('步骤：' + name);};
  const fail = (reason = 'PAGE', definite = true) => {const e = new MemberStop(reason, definite); e.step = current; return e;};
  try {
    const page = context.pages()[0] || await context.newPage();
    step('打开页面');
    await page.goto(IMAGINE_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
    await humanPause(page, 3000, 5000);
    const cookie = await visible(page.getByRole('button', {name: /Dismiss cookie notice/i}));
    if (cookie) {await cookie.click(); await humanPause(page);}
    await stopIfBlocked(page);
    const findBox = () => page.getByRole('textbox', {name: PROMPT_BOX}).or(page.locator('[contenteditable="true"], textarea'));
    if (!await waitVisible(page, findBox, 30000)) {await stopIfBlocked(page); throw fail();}
    step('切图片');
    const imageMode = await waitVisible(page, () => page.getByRole('radio', {name: IMAGE_MODE}).or(page.getByRole('button', {name: IMAGE_MODE})), 10000);
    if (!imageMode) throw fail();
    if (await imageMode.getAttribute('aria-checked') !== 'true') {await imageMode.click(); await humanPause(page);}
    if (await imageMode.getAttribute('aria-checked') === 'false') throw fail();
    const want = grokRatio(ratio);
    if (want) {
      step('选宽高比');
      const picker = await waitVisible(page, () => page.getByRole('button', {name: /宽高比|aspect ratio/i}), 10000);
      if (!picker) throw fail();
      if (!(await picker.innerText().catch(() => '')).includes(want)) {
        await picker.click(); await humanPause(page);
        const name = new RegExp('^\\s*' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
        const option = await waitVisible(page, () => page.getByRole('menuitemradio', {name}).or(page.getByRole('menuitem', {name})).or(page.getByRole('option', {name})), 5000);
        if (!option) throw fail();
        await option.click(); await humanPause(page);
        if (await picker.getAttribute('data-state') === 'open') await page.keyboard.press('Escape').catch(() => {});
      }
    }
    step('找输入框');
    const box = await waitVisible(page, findBox, 10000);
    if (!box) throw fail();
    step('输入');
    await box.click(); await humanPause(page, 400, 900);
    await page.keyboard.type(prompt.trim(), {delay: rand(25, 60)});
    await humanPause(page, 800, 1600);
    const before = new Set(await page.evaluate(() => [...document.images].map(i => i.currentSrc || i.src)));
    step('提交');
    const findSubmit = () => page.getByRole('button', {name: SUBMIT}).or(page.locator('button[type="submit"]'));
    const boxText = async () => ((await box.inputValue().catch(() => null)) ?? (await box.innerText().catch(() => ''))).trim();
    if (dryRun) {
      if (!await waitVisible(page, findSubmit, 10000)) throw fail();
      // Rehearsal: stop before submitting and clear what was typed.
      await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); return {dryRun: true, step: current};
    }
    await submitWithRecheck({
      find: ms => waitVisible(page, findSubmit, ms),
      enabled: btn => btn.isEnabled().catch(() => false),
      hasText: async () => (await boxText()).length > 0,
      click: async btn => {submitted = true; await btn.click();},
      responded: async () => {const end = Date.now() + 8000; while (Date.now() < end) {await page.waitForTimeout(800); if (!(await boxText()).length) return true;} return false;},
      settle: () => humanPause(page, 2500, 4000),
      log,
    });
    step('等图');
    const deadline = Date.now() + timeoutMs;
    let pick = null, stableSince = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      await stopIfBlocked(page);
      const found = await page.evaluate(seen => {
        const fresh = [...document.images].filter(i => !seen.includes(i.currentSrc || i.src) && i.complete && i.naturalWidth >= 512 && i.naturalHeight >= 512 && i.offsetParent);
        return fresh.map(i => ({src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight}));
      }, [...before]);
      const best = found.sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
      if (best && pick?.src === best.src) {if (Date.now() - stableSince > 6000) break;}
      else if (best) {pick = best; stableSince = Date.now();}
    }
    if (!pick) throw fail('TIMEOUT', false);
    step('下载');
    await humanPause(page);
    const bytes = await downloadOriginal(page, pick.src);
    if (!bytes?.length) throw fail('PAGE', false);
    return {bytes, width: pick.w, height: pick.h};
  } catch (error) {
    let out = error;
    // Nothing reached Grok before the click: an unexpected page error is a definite failure, so the quota is refunded.
    if (!(out instanceof MemberStop) && !submitted) {out = new MemberStop('PAGE', true); out.detail = String(error?.message || error).slice(0, 200);}
    if (out && typeof out === 'object' && !out.step) out.step = current;
    log('卡在步骤：' + (current || '启动') + '（' + (out?.reason || out?.message || out) + (out?.detail ? '：' + out.detail : '') + '）');
    throw out;
  }
}

/** Prefer the page's own download button; otherwise read the image the page already shows. */
async function downloadOriginal(page, src) {
  const image = page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).first();
  try {
    await image.hover(); await humanPause(page, 500, 1000);
    const button = await visible(page.getByRole('button', {name: /下载|download/i}));
    if (button) {
      const [download] = await Promise.all([page.waitForEvent('download', {timeout: 20000}), button.click()]);
      const file = await download.path();
      if (file) return await fs.readFile(file);
    }
  } catch {}
  if (src.startsWith('data:')) return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  const b64 = await page.evaluate(async url => {
    const blob = await (await fetch(url)).blob();
    return await new Promise(r => {const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1] || ''); f.readAsDataURL(blob);});
  }, src).catch(() => '');
  return b64 ? Buffer.from(b64, 'base64') : null;
}

export function sniff(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return {mime: 'image/png', ext: 'png'};
  if (bytes[0] === 255 && bytes[1] === 216) return {mime: 'image/jpeg', ext: 'jpg'};
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return {mime: 'image/webp', ext: 'webp'};
  return null;
}

/** Keeps the original in the archive folder and returns a JPEG/PNG at or under 3MB. */
export async function saveAndCompress(bytes, {id, archiveDir, limit = IMAGE_BYTES, sips = (...a) => run('/usr/bin/sips', a)}) {
  const type = sniff(bytes);
  if (!type) throw new MemberStop('PAGE', false);
  await fs.mkdir(archiveDir, {recursive: true});
  const original = path.join(archiveDir, `${id}-original.${type.ext}`);
  await fs.writeFile(original, bytes);
  if (bytes.length <= limit && type.mime !== 'image/webp') return {original, mime: type.mime, bytes, before: bytes.length, after: bytes.length};
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-member-'));
  try {
    for (const [quality, size] of [[90, 0], [82, 0], [75, 0], [75, 3072], [70, 2560], [65, 2048]]) {
      const out = path.join(work, `${quality}-${size}.jpg`);
      await sips('-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...(size ? ['-Z', String(size)] : []), original, '--out', out);
      const result = await fs.readFile(out);
      if (result.length <= limit) {
        const kept = path.join(archiveDir, `${id}.jpg`); await fs.writeFile(kept, result);
        return {original, mime: 'image/jpeg', bytes: result, before: bytes.length, after: result.length};
      }
    }
  } finally {await fs.rm(work, {recursive: true, force: true});}
  throw new MemberStop('PAGE', false);
}
