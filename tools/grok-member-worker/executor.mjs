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
      args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
    });
  } catch (error) {
    if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(String(error?.message))) throw new MemberStop('BUSY');
    throw error;
  }
}

/** Runs one prompt on grok.com/imagine and returns the original image bytes. */
export async function imagineOnce(context, {prompt, ratio}, {timeoutMs = 240000, log = () => {}} = {}) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(IMAGINE_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await humanPause(page, 4000, 6000);
  const cookie = await visible(page.getByRole('button', {name: /Dismiss cookie notice|关闭/i}));
  if (cookie) {await cookie.click(); await humanPause(page);}
  await stopIfBlocked(page);
  const imageMode = await visible(page.getByRole('button', {name: /^(图片|Image)$/}));
  if (imageMode) {await imageMode.click(); await humanPause(page);}
  if (ratio) {
    const picker = await visible(page.getByRole('button', {name: /宽高比|aspect ratio/i}));
    if (!picker) throw new MemberStop('PAGE');
    await picker.click(); await humanPause(page);
    const option = await visible(page.getByRole('menuitem', {name: ratio})) || await visible(page.getByRole('option', {name: ratio}))
      || await visible(page.getByRole('menuitemradio', {name: ratio})) || await visible(page.getByText(ratio, {exact: true}));
    if (!option) throw new MemberStop('PAGE');
    await option.click(); await humanPause(page);
    await page.keyboard.press('Escape').catch(() => {});
  }
  const box = await visible(page.locator('[contenteditable="true"]')) || await visible(page.locator('textarea'));
  if (!box) throw new MemberStop('PAGE');
  await box.click(); await humanPause(page, 400, 900);
  await page.keyboard.type(prompt.trim(), {delay: rand(25, 60)});
  await humanPause(page, 800, 1600);
  const before = new Set(await page.evaluate(() => [...document.images].map(i => i.currentSrc || i.src)));
  const submit = await visible(page.getByRole('button', {name: /^(提交|Submit|发送|Send)$/i}));
  if (!submit) throw new MemberStop('PAGE');
  await submit.click();
  log('已提交提示词，等待 Grok 出图');
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
  if (!pick) throw new MemberStop('TIMEOUT', false);
  await humanPause(page);
  const bytes = await downloadOriginal(page, pick.src);
  if (!bytes?.length) throw new MemberStop('PAGE', false);
  return {bytes, width: pick.w, height: pick.h};
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
