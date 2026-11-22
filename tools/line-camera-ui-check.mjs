// Isolated browser check. Not part of the default test glob.
// It does not open the user's MuseCanvas install or the studio main bundle.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const harnessDir = path.join(root, 'integrations/musecanvas');
const out = '/opt/cursor/artifacts/line-camera';
fs.mkdirSync(out, {recursive: true});
const port = 8765;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {cwd: harnessDir, stdio: 'ignore'});
await new Promise(resolve => setTimeout(resolve, 300));

const puppeteer = await import(pathToFileURL('/tmp/lc-ui/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js').href).catch(async () => import('/tmp/lc-ui/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'));
const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const report = {steps: [], webm: null, stills: [], errors: []};
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1440, height: 1000});
  const session = await page.createCDPSession();
  await session.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: out, eventsEnabled: true});
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-lc="root"]');
  await shot(page, '01-empty');
  await page.click('[data-lc="export-stills"]');
  await page.waitForFunction(() => document.querySelector('[data-lc="status"]').textContent.includes('路线为空'));
  report.steps.push('empty-export');

  await page.click('[data-lc="mode-points"]');
  const box = await page.$eval('[data-lc="stroke"]', el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; });
  await page.mouse.click(box.x + box.width * .2, box.y + box.height * .3);
  await page.click('[data-lc="export-stills"]');
  await page.waitForFunction(() => document.querySelector('[data-lc="status"]').textContent.includes('只有一个点'));
  await shot(page, '02-single-point');
  report.steps.push('single-point');

  await page.click('[data-lc="clear"]');
  await page.click('[data-lc="mode-draw"]');
  const drawn = await page.$eval('[data-lc="stroke"]', el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; });
  await page.mouse.move(drawn.x + 30, drawn.y + drawn.height * .75);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(drawn.x + 30 + (drawn.width - 60) * t, drawn.y + drawn.height * (.75 - .45 * Math.sin(t * Math.PI)));
  }
  await page.mouse.up();
  await page.waitForFunction(() => Number(document.querySelector('[data-lc="summary"]').textContent.split(' ')[0]) >= 2);
  await shot(page, '03-drawn');
  report.steps.push('drawn');

  await page.click('[data-lc="mode-edit"]');
  await page.mouse.move(drawn.x + drawn.width * .5, drawn.y + drawn.height * .4);
  await page.mouse.down();
  await page.mouse.move(drawn.x + drawn.width * .58, drawn.y + drawn.height * .28);
  await page.mouse.up();
  await page.click('[data-lc="duration"]', {clickCount: 3});
  await page.keyboard.press('Backspace');
  await page.keyboard.type('8');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-lc="duration"]').value === '8');
  await shot(page, '04-edited');
  report.steps.push('edited-duration');

  const before = await page.$eval('[data-lc="time"]', el => el.textContent);
  await page.click('[data-lc="play"]');
  await page.waitForFunction(start => document.querySelector('[data-lc="time"]').textContent !== start, {}, before);
  await shot(page, '05-preview');
  await page.click('[data-lc="play"]');
  await page.waitForFunction(() => document.querySelector('[data-lc="play"]').textContent === '播放');
  const paused = await page.$eval('[data-lc="time"]', el => el.textContent);
  await new Promise(resolve => setTimeout(resolve, 400));
  const held = await page.$eval('[data-lc="time"]', el => el.textContent);
  if (held !== paused) throw Error('暂停后时间仍在走：' + paused + ' -> ' + held);
  await page.click('[data-lc="play"]');
  await new Promise(resolve => setTimeout(resolve, 200));
  await page.click('[data-lc="play"]');
  report.steps.push('pause-resume');

  await page.click('[data-lc="save"]');
  await page.waitForFunction(() => document.querySelector('#card').textContent.includes('图像点'));
  const savedCount = await page.evaluate(() => window.__lineCameraHarness.node.metadata.lineCamera.imageStroke.points.length);
  await page.click('#reopen');
  await page.waitForSelector('[data-lc="root"]');
  const reloaded = await page.evaluate(() => window.__lineCameraHarness.node.metadata.lineCamera.imageStroke.points.length);
  if (reloaded !== savedCount || reloaded < 2) throw Error('重开后路线点数不对');
  const title = await page.evaluate(() => window.__lineCameraHarness.node.metadata.title);
  const ai = await page.evaluate(() => window.__lineCameraHarness.calls.ai);
  if (title !== '保留我' || ai !== 0) throw Error('旧字段被改或触发了生成');
  await shot(page, '06-reloaded');
  report.steps.push('reloaded');

  await page.click('[data-lc="export-json"]');
  await page.click('[data-lc="export-stills"]');
  await page.waitForFunction(() => document.querySelector('[data-lc="status"]').textContent.includes('静帧'));
  const duration = await page.$eval('[data-lc="duration"]', el => el.value);
  await page.click('[data-lc="duration"]', {clickCount: 3});
  await page.keyboard.press('Backspace');
  await page.keyboard.type('1.2');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-lc="duration"]').value === '1.2');
  await page.click('[data-lc="export-video"]');
  await page.waitForFunction(() => /WebM|不能录制|录制失败|没有录到/.test(document.querySelector('[data-lc="status"]').textContent), {timeout: 20000});
  const videoStatus = await page.$eval('[data-lc="status"]', el => el.textContent);
  report.webm = videoStatus;
  report.previousDuration = duration;
  await shot(page, '07-exported');
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const names = fs.readdirSync(out);
    const ready = names.some(name => name.endsWith('.webm')) && names.filter(name => name.endsWith('.png') && name.startsWith('线控')).length >= 3 && names.some(name => name.endsWith('.json'));
    if (ready && !names.some(name => name.endsWith('.crdownload'))) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  report.files = fs.readdirSync(out);
} catch (error) {
  report.failed = String(error.stack || error);
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.kill();
}
console.log(JSON.stringify(report, null, 2));

async function shot(page, name) {
  await page.screenshot({path: path.join(out, name + '.png'), fullPage: true});
}
