import {beginAttempt, classifyStillReferences, createStillRun, failAttempt, finishAttempt, planStillReferences, renderStillCompare} from './still-refs.mjs';

const PNG = {
  prop: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4VqVHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAEss+EyYSPYfAAAAAElFTkSuQmCC',
  person: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGMwyThCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAMA5gEzjVtVJAAAAAElFTkSuQmCC',
  place: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPQmxZDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAO1YgD3HjKlcAAAAAElFTkSuQmCC',
  output: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGOo81hBU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAOw0uEz7487fAAAAAElFTkSuQmCC',
};

export const FIXTURES = {
  prop: {name: '样例道具', type: '道具', src: PNG.prop},
  person: {name: '样例人物', type: '人物', src: PNG.person},
  place: {name: '样例场景', type: '场景', src: PNG.place},
  output: PNG.output,
  remote: {name: '外链样例', src: 'https://example.invalid/ref.png'},
};

const ordered = [FIXTURES.prop, FIXTURES.person, FIXTURES.place];

export async function demoState() {
  const ready = await planStillReferences(ordered, {wire: 'still', ratio: '16:9'});
  let done = beginAttempt(createStillRun());
  done = finishAttempt(done, FIXTURES.output, '2');
  let retry = beginAttempt(createStillRun());
  retry = finishAttempt(retry, FIXTURES.output, '2');
  retry = beginAttempt(retry);
  retry = failAttempt(retry, Error('样例失败：没有调用出图接口'));
  const blocked = classifyStillReferences([FIXTURES.prop, FIXTURES.person, FIXTURES.remote], {wire: 'still', origin: 'https://zinc-raven-rocket-drift.grok.me'});
  return {ready, done, retry, blocked, output: FIXTURES.output, bytesSame: done.output === FIXTURES.output};
}

function section(id, title, html, extra = '') {
  return `<section data-demo="${id}"><h2>${title}</h2>${extra}${html}</section>`;
}

export function renderPage(state) {
  return `${section('ready', '1. 将要发送的参考', renderStillCompare({plan: state.ready, title: '样例参考，按道具、人物、场景'}))}
${section('done', '2. 结果与参考对照', renderStillCompare({plan: state.ready, run: state.done, title: '样例输出'}), `<p class="byte-check" data-byte-check>输出与未盖章原图一致：${state.bytesSame ? '是' : '否'}</p>`)}
${section('retry', '3. 失败后上一张还在', renderStillCompare({plan: state.ready, run: state.retry, title: '样例重试'}))}
${section('blocked', '4. 外部地址让整单停住', renderStillCompare({plan: state.blocked, title: '样例拦截'}))}`;
}

export async function mount(root) {
  const state = await demoState();
  const paint = () => { root.innerHTML = renderPage(state); };
  paint();
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-still-act="retry"]');
    if (!button || !button.closest('[data-demo="retry"]')) return;
    state.retry = beginAttempt(state.retry);
    paint();
    setTimeout(() => {
      state.retry = finishAttempt(state.retry, FIXTURES.output, '3');
      state.bytesSame = state.retry.output === FIXTURES.output;
      paint();
    }, 1200);
  });
  return state;
}
