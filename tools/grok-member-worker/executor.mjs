// Drives the member's own logged-in grok.com/imagine page like a person would:
// one job at a time, normal clicks and typing only. It never reads cookies or
// tokens, never calls private endpoints, and never tries to get past a captcha.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
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
export const STRUCTURE_STEPS = Object.freeze(['打开页面', '切图片', '选宽高比', '找输入框', '输入', '上传参考图', '改图', '提交', '等图', '下载']);
export function structureStop(step, definite = true) {
  const e = new MemberStop('STRUCTURE', definite);
  e.step = step;
  e.detail = '网页结构变化：' + step;
  return e;
}
/** Reads a page hint such as 「最多 3 张」. Returns null when the page does not say. */
export function limitFromText(text) {
  const found = /最多\s*([1-9]\d?)\s*张|up to\s*([1-9]\d?)\s*(?:images|photos)/i.exec(String(text || ''));
  if (!found) return null;
  const n = Number(found[1] || found[2]);
  return n > 0 && n <= 3 ? n : null;
}
/** Decides a single upload. A missing or non-image control is a structure change, not a retry. */
export function planReferenceUpload({count, control}) {
  if (!control) return {ok: false, structure: true};
  const accept = String(control.accept || '');
  if (accept && !/image|png|jpe?g|webp/i.test(accept)) return {ok: false, structure: true};
  const stated = Number.isInteger(control.max) && control.max > 0 ? control.max : null;
  const limit = control.multiple ? (stated ?? count) : 1;
  if (count > limit) return {ok: false, reason: 'REF_LIMIT', limit};
  return {ok: true, limit};
}
/**
 * Sets the page's file input once. If it is missing, reveals it at most once.
 * A still-missing or changed control stops with 网页结构变化 and does not try again.
 */
export async function attachReferences({files, step = '上传参考图', findControl, reveal, setFiles}) {
  if (!files?.length) return {uploaded: 0};
  let control = await findControl();
  if (!control && reveal) {
    const opened = await reveal();
    if (opened) control = await findControl();
  }
  if (!control) throw structureStop(step);
  const plan = planReferenceUpload({count: files.length, control});
  if (!plan.ok) throw plan.structure ? structureStop(step) : Object.assign(new MemberStop(plan.reason || 'REF_LIMIT', true), {step, detail: plan.limit ? `网页当前允许 ${plan.limit} 张` : ''});
  try {await setFiles(control, files);} catch {throw structureStop(step);}
  return {uploaded: files.length, limit: plan.limit};
}
/**
 * Waits until every reference shows as a thumbnail in the composer, nothing is still uploading,
 * and 提交 is clickable. A slow or failed upload is a definite structure stop (quota refunded),
 * so a prompt is never submitted as text-only by accident.
 */
export async function waitReferencesReady({count, read, sleep, step = '上传参考图', ms = 30000, now = Date.now}) {
  const end = now() + ms;
  let last = {thumbs: 0, uploading: false, submitEnabled: false};
  for (;;) {
    last = await read();
    if (last.thumbs >= count && !last.uploading && last.submitEnabled) return last;
    if (now() > end) {
      const e = structureStop(step);
      e.detail = `参考图未上传完成（缩略图 ${last.thumbs}/${count}${last.uploading ? '，仍在上传' : ''}${last.submitEnabled ? '' : '，提交不可点'}）`;
      throw e;
    }
    await sleep(500);
  }
}
/** True when w:h is within 8% of the requested ratio (or no ratio was asked). */
export function ratioMatches(w, h, ratio) {
  if (!ratio) return true;
  const [a, b] = String(ratio).split(':').map(Number);
  if (!(a > 0 && b > 0 && w > 0 && h > 0)) return false;
  return Math.abs(Math.log((w / h) / (a / b))) < 0.08;
}
/**
 * Picks this submission's image from candidates that are new since submit and outside feed/promo areas.
 * All candidates must come from one result group; reference images and wrong shapes are refused.
 * Returns null when nothing trustworthy is there yet.
 */
export function pickResult(candidates, {refSrcs = [], ratio = ''} = {}) {
  const ok = (candidates || []).filter(c => !c.excluded && c.w >= 512 && c.h >= 512 && !refSrcs.includes(c.src));
  if (!ok.length) return null;
  const groups = new Map();
  for (const c of ok) groups.set(c.group, [...(groups.get(c.group) || []), c]);
  // The result of this submission is the newest group; older new groups are lazy-loaded page content.
  const group = [...groups.values()].sort((a, b) => (b[0].order ?? 0) - (a[0].order ?? 0))[0];
  const best = group.filter(c => ratioMatches(c.w, c.h, ratio)).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return best || null;
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
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
export const STEPS = STRUCTURE_STEPS;
async function readFileControl(page) {
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const locator = inputs.nth(i);
    const accept = (await locator.getAttribute('accept').catch(() => '')) || '';
    if (accept && !/image|png|jpe?g|webp/i.test(accept)) continue;
    const multiple = (await locator.getAttribute('multiple').catch(() => null)) != null;
    const maxAttr = await locator.getAttribute('data-max').catch(() => '');
    const max = /^[1-9]\d?$/.test(maxAttr || '') ? Number(maxAttr) : null;
    return {locator, accept, multiple, max};
  }
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
export async function imagineOnce(context, {prompt, ratio, files = [], uploadStep = '上传参考图'}, {timeoutMs = 240000, log = () => {}, dryRun = false, trace = [], shotDir = ''} = {}) {
  let current = '', submitted = false, page;
  const note = async (name, state = {}) => {
    const entry = {step: name, at: Date.now(), ...state};
    if (shotDir && page) {
      const file = path.join(shotDir, `${Date.now()}-${name}.png`);
      try {await fs.mkdir(shotDir, {recursive: true}); await page.screenshot({path: file}); entry.shot = file;} catch {}
    }
    trace.push(entry);
  };
  const step = name => {current = name; log('步骤：' + name);};
  const fail = (reason = 'PAGE', definite = true) => {const e = new MemberStop(reason, definite); e.step = current; return e;};
  const structure = (name, definite = true) => structureStop(name || current, definite);
  try {
    // A fresh tab per job: a reused tab can still show an earlier job's results.
    page = await context.newPage();
    step('打开页面');
    await page.goto(IMAGINE_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
    await humanPause(page, 3000, 5000);
    const cookie = await visible(page.getByRole('button', {name: /Dismiss cookie notice/i}));
    if (cookie) {await cookie.click(); await humanPause(page);}
    await stopIfBlocked(page);
    const findBox = () => page.getByRole('textbox', {name: PROMPT_BOX}).or(page.locator('[contenteditable="true"], textarea'));
    if (!await waitVisible(page, findBox, 30000)) {await stopIfBlocked(page); throw structure('打开页面');}
    step('切图片');
    const imageMode = await waitVisible(page, () => page.getByRole('radio', {name: IMAGE_MODE}).or(page.getByRole('button', {name: IMAGE_MODE})), 10000);
    if (!imageMode) throw structure('切图片');
    if (await imageMode.getAttribute('aria-checked') !== 'true') {await imageMode.click(); await humanPause(page);}
    if (await imageMode.getAttribute('aria-checked') === 'false') throw structure('切图片');
    const want = grokRatio(ratio);
    if (want) {
      step('选宽高比');
      const picker = await waitVisible(page, () => page.getByRole('button', {name: /宽高比|aspect ratio/i}), 10000);
      if (!picker) throw structure('选宽高比');
      if (!(await picker.innerText().catch(() => '')).includes(want)) {
        await picker.click(); await humanPause(page);
        const name = new RegExp('^\\s*' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
        const option = await waitVisible(page, () => page.getByRole('menuitemradio', {name}).or(page.getByRole('menuitem', {name})).or(page.getByRole('option', {name})), 5000);
        if (!option) throw structure('选宽高比');
        await option.click(); await humanPause(page);
        if (await picker.getAttribute('data-state') === 'open') await page.keyboard.press('Escape').catch(() => {});
      }
    }
    step('找输入框');
    const box = await waitVisible(page, findBox, 10000);
    if (!box) throw structure('找输入框');
    if (files.length) {
      step(uploadStep);
      const hint = limitFromText(await page.locator('body').innerText().catch(() => ''));
      await attachReferences({
        files, step: uploadStep,
        findControl: async () => {const control = await readFileControl(page); if (control && hint && control.max == null) control.max = hint; return control;},
        reveal: async () => {
          const button = await visible(page.getByRole('button', {name: /上传图片|添加图片|添加参考|attach image|upload image/i}));
          if (!button) return false;
          await button.click();
          await humanPause(page);
          return true;
        },
        setFiles: (control, list) => control.locator.setInputFiles(list),
      });
      await chooseReferenceUse(page);
      const ready = await waitReferencesReady({count: files.length, step: uploadStep, sleep: ms => page.waitForTimeout(ms), read: () => readComposer(page, findSubmitButton(page))});
      await note('上传后', ready);
    }
    step('输入');
    await box.click(); await humanPause(page, 400, 900);
    await page.keyboard.type(prompt.trim(), {delay: rand(25, 60)});
    await humanPause(page, 800, 1600);
    step('提交');
    const findSubmit = () => findSubmitButton(page);
    // Re-check what Grok will actually run before spending the member's quota.
    if (await imageMode.getAttribute('aria-checked') === 'false') throw structure('切图片');
    if (want) {
      const picker = await visible(page.getByRole('button', {name: /宽高比|aspect ratio/i}));
      if (!picker || !(await picker.innerText().catch(() => '')).includes(want)) throw structure('选宽高比');
    }
    const composer = await readComposer(page, findSubmit());
    if (files.length && composer.thumbs < files.length) throw structure(uploadStep);
    const refSrcs = composer.srcs;
    // Everything on the page now is old: only elements that appear after submit can be this job's result.
    await page.evaluate(() => {for (const el of document.querySelectorAll('*')) el.setAttribute('data-jbp-pre', '1');});
    await note('提交前', {ratio: want, refs: composer.thumbs});
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
      const best = pickResult(await readFreshImages(page), {refSrcs, ratio: want});
      if (best && pick?.src === best.src) {if (Date.now() - stableSince > 6000) break;}
      else if (best) {pick = best; stableSince = Date.now();}
    }
    await note('选结果', pick ? {src: pick.src.slice(0, 120), w: pick.w, h: pick.h, group: pick.group} : {found: false});
    if (!pick) throw fail('TIMEOUT', false);
    step('下载');
    await humanPause(page);
    const bytes = await downloadOriginal(page, pick.src);
    if (!bytes?.length) throw structure('下载', false);
    // Never hand a member their own reference back as the result.
    const refHashes = new Set(await Promise.all(files.map(async f => sha256(await fs.readFile(f)))));
    if (refHashes.has(sha256(bytes))) {const e = fail('PAGE', false); e.detail = '结果与参考图相同'; throw e;}
    return {bytes, width: pick.w, height: pick.h, trace};
  } catch (error) {
    let out = error;
    // Nothing reached Grok before the click: an unexpected page error is a definite failure, so the quota is refunded.
    if (!(out instanceof MemberStop) && !submitted) {out = new MemberStop('PAGE', true); out.detail = String(error?.message || error).slice(0, 200);}
    if (out && typeof out === 'object' && !out.step) out.step = current;
    if (out && typeof out === 'object') out.trace = trace;
    log('卡在步骤：' + (current || '启动') + '（' + (out?.reason || out?.message || out) + (out?.detail ? '：' + out.detail : '') + '）');
    throw out;
  }
}

function findSubmitButton(page) {return page.getByRole('button', {name: SUBMIT}).or(page.locator('button[type="submit"]'));}

/** If Grok asks how to use an uploaded image (e.g. 首帧 vs 参考), pick reference. */
async function chooseReferenceUse(page) {
  const choice = await waitVisible(page, () => page.getByRole('button', {name: /^(用作参考|作为参考|参考图|参考|Use as reference|Reference)$/i}).or(page.getByRole('menuitem', {name: /参考|reference/i})).or(page.getByRole('radio', {name: /参考|reference/i})), 2000);
  if (choice) {await choice.click().catch(() => {}); await humanPause(page, 400, 900);}
}

/** Reads the composer: reference thumbnails, whether anything is still uploading, and whether 提交 is enabled. */
async function readComposer(page, submit) {
  const box = page.locator('form').filter({has: page.locator('[contenteditable="true"], textarea')}).first();
  const state = await box.evaluate(form => {
    const imgs = [...form.querySelectorAll('img')].filter(i => i.offsetParent && i.complete && i.naturalWidth > 0);
    const uploading = !!form.querySelector('[role="progressbar"], progress, [aria-busy="true"], [class*="spinner" i], [class*="loading" i], [class*="uploading" i]');
    return {thumbs: imgs.length, srcs: imgs.map(i => i.currentSrc || i.src), uploading};
  }).catch(() => ({thumbs: 0, srcs: [], uploading: false}));
  const btn = await visible(submit);
  state.submitEnabled = btn ? await btn.isEnabled().catch(() => false) : false;
  return state;
}

/**
 * Lists images added after submit. Each is grouped by the outermost new element holding it, so one
 * submission's result card is one group. Images inside links, nav/aside, feeds or promo blocks are excluded.
 */
async function readFreshImages(page) {
  return page.evaluate(() => {
    const promo = /广告|推广|赞助|Sponsored|Promoted|Advertisement|Upgrade to|升级到|探索|Explore|Discover|社区|Community|Trending|热门/i;
    const out = [];
    let order = 0;
    const tops = new Map();
    for (const el of document.querySelectorAll('*')) if (!el.hasAttribute('data-jbp-pre')) el.setAttribute('data-jbp-order', el.getAttribute('data-jbp-order') || String(++order + Date.now()));
    for (const img of document.images) {
      if (img.hasAttribute('data-jbp-pre') || !img.complete || !img.offsetParent) continue;
      let top = img;
      while (top.parentElement && !top.parentElement.hasAttribute('data-jbp-pre')) top = top.parentElement;
      if (!tops.has(top)) tops.set(top, tops.size + 1);
      const region = img.closest('a[href], nav, aside, header, footer, [role="feed"], [role="complementary"], [aria-label*="feed" i], [data-testid*="feed" i], [data-testid*="promo" i]');
      const text = (top.innerText || '').slice(0, 400);
      out.push({src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, group: tops.get(top), order: Number(top.getAttribute('data-jbp-order')) || 0, excluded: !!region || promo.test(text)});
    }
    return out;
  });
}

/** Uses only the download button inside the image's own card; otherwise reads the image by its src. */
async function downloadOriginal(page, src) {
  try {
    const found = await page.evaluate(want => {
      document.querySelectorAll('[data-jbp-dl]').forEach(b => b.removeAttribute('data-jbp-dl'));
      const img = [...document.images].find(i => (i.currentSrc || i.src) === want);
      const isDl = b => /下载|download/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || ''));
      for (let card = img?.parentElement, depth = 0; card && depth < 6; card = card.parentElement, depth++) {
        // Stop once the box holds another large image: beyond that it is no longer this image's card.
        if ([...card.querySelectorAll('img')].some(i => i !== img && i.naturalWidth >= 256)) break;
        const btn = [...card.querySelectorAll('button, [role="button"]')].find(isDl);
        if (btn) {btn.setAttribute('data-jbp-dl', '1'); return true;}
      }
      return false;
    }, src);
    if (found) {
      await page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).first().hover().catch(() => {});
      await humanPause(page, 500, 1000);
      const button = page.locator('[data-jbp-dl]').first();
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
  if (!type) throw structureStop('下载', false);
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
