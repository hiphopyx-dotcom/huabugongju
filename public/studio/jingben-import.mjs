import {projectsFromJingben} from './jingben-bridge.mjs?v=g11pack';
import * as C from './core.mjs?v=bd900549f538';
import * as DB from './db.mjs?v=bd900549f538';

const input = document.querySelector('#import');
const toast = document.querySelector('#toast');
const say = text => { if (!toast) return; toast.textContent = text; toast.style.display = 'block'; };
const note = sessionStorage.getItem('jbp-import-note');
if (note) { sessionStorage.removeItem('jbp-import-note'); say(note); setTimeout(() => { if (toast) toast.style.display = 'none'; }, 4500); }
if (!input) throw Error('missing import');
input.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const original = input.onchange;
  input.onchange = null;
  event.stopImmediatePropagation();
  (async () => {
    try {
      if (file.size > 250 * 1024 * 1024) throw Error('项目包超过 250MB');
      const head = await file.slice(0, 240).text();
      const jingben = head.includes('"jingben_projects"') || head.includes('"jingben_images"');
      if (!jingben) {
        input.onchange = original;
        original?.call(input, event);
        return;
      }
      say('正在读片场备份，文件很大，请等一下…');
      const raw = JSON.parse(await file.text());
      const made = projectsFromJingben(raw, () => C.uid()).map(item => C.validate(item));
      if (!made.length) throw Error('这份片场备份里没有项目');
      say(`正在写入 ${made.length} 个项目…`);
      for (const item of made) { delete item.bridge; await DB.put(item); }
      const pictures = made.reduce((sum, item) => sum + item.assets.length, 0);
      sessionStorage.setItem('jbp-import-note', `已接入 ${made.length} 个项目，${pictures} 张图`);
      location.replace('/?project=' + encodeURIComponent(made[0].id));
    } catch (error) {
      say('导入失败：' + (error?.message || error));
      input.value = '';
    } finally {
      if (!input.onchange) input.onchange = original;
    }
  })();
}, true);
