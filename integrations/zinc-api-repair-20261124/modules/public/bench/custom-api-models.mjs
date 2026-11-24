import { isBlockedProvider as blockedHost } from "./provider-block.mjs";
/* 剧爆棚 /bench：自定义 OpenAI 兼容 API（切换 / 添加模型）
 * 只给管理员看选择器。密钥只存在这台浏览器里，不写入项目备份、不进日志、不随接口发出。
 * 付费 xAI 保持关闭。本文件不发起真实出图请求。
 */
const META_KEY = 'jbp-custom-openai-models-v1';
const KEYS_KEY = 'jbp-custom-openai-keys-v1';
const BLOCKED_HOSTS = /(?:^|\.)(?:x\.ai|api\.x\.ai|api\.x\.com)$/i;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DISPLAY_AS_MODEL = /国际版|国内版|我的模型|自定义|\s/;

export const PRESETS = Object.freeze([
  {
    id: 'agnes-international',
    name: 'Agnes 国际版',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    modelPlaceholder: 'agnes-3.0-flash',
  },
  {
    id: 'agnes-cn',
    name: 'Agnes 国内版',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    modelPlaceholder: 'agnes-3.0-flash',
  },
]);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

export function isBlockedProvider(baseUrl) {
  return blockedHost(baseUrl);
}

export function modelLooksLikeDisplayName(model) {
  const m = String(model ?? '').trim();
  return !m || DISPLAY_AS_MODEL.test(m) || !MODEL_ID.test(m);
}

export function validateEntry({name, baseUrl, model}) {
  const display = String(name ?? '').trim();
  const url = normalizeBaseUrl(baseUrl);
  const modelId = String(model ?? '').trim();
  if (!display) return '请填写显示名';
  if (display.length > 60) return '显示名请控制在 60 个字以内';
  if (!url) return '请填写接口地址（Base URL）';
  let parsed;
  try { parsed = new URL(url); }
  catch { return '接口地址不是有效网址'; }
  if (parsed.protocol !== 'https:') return '接口地址必须是 https';
  if (parsed.username || parsed.password) return '接口地址里不要带账号或密码';
  if (parsed.hash || parsed.search) return '接口地址不要带查询参数或锚点';
  if (isBlockedProvider(url)) return '付费 xAI 接口保持关闭，请改用其他 OpenAI 兼容地址';
  if (!modelId) return '请填写模型名（用官方 id，例如 agnes-3.0-flash）';
  if (modelLooksLikeDisplayName(modelId)) {
    return '模型名请用官方 id（例如 agnes-3.0-flash），不要把「Agnes 国内版」这种显示名填进模型名';
  }
  return '';
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

function store(storage) {
  return storage || (typeof localStorage === 'undefined' ? memoryStorage() : localStorage);
}

function readJson(storage, key, fallback) {
  try {
    const raw = store(storage).getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data == null ? fallback : data;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  store(storage).setItem(key, JSON.stringify(value));
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function loadCatalog(storage) {
  const data = readJson(storage, META_KEY, {version: 1, activeId: '', items: []});
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    version: 1,
    activeId: typeof data.activeId === 'string' ? data.activeId : '',
    items: items.map(item => ({
      id: String(item.id || uid()),
      name: String(item.name || ''),
      baseUrl: normalizeBaseUrl(item.baseUrl || ''),
      model: String(item.model || ''),
      created: Number(item.created) || Date.now(),
      updated: Number(item.updated) || Date.now(),
    })),
  };
}

export function listPublic(storage) {
  const keys = readJson(storage, KEYS_KEY, {});
  const catalog = loadCatalog(storage);
  return {
    activeId: catalog.activeId,
    items: catalog.items.map(item => ({
      id: item.id,
      name: item.name,
      baseUrl: item.baseUrl,
      model: item.model,
      hasKey: Boolean(keys[item.id]),
      created: item.created,
      updated: item.updated,
      active: item.id === catalog.activeId,
    })),
  };
}

export function upsertEntry(input, storage) {
  const error = validateEntry(input);
  if (error) throw Error(error);
  const catalog = loadCatalog(storage);
  const keys = readJson(storage, KEYS_KEY, {});
  const now = Date.now();
  const id = String(input.id || uid());
  const next = {
    id,
    name: String(input.name).trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: String(input.model).trim(),
    created: catalog.items.find(item => item.id === id)?.created || now,
    updated: now,
  };
  const items = catalog.items.filter(item => item.id !== id);
  items.unshift(next);
  const incomingKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (incomingKey) keys[id] = incomingKey;
  if (!keys[id]) throw Error('请填写 API Key。密钥只保存在这台浏览器，不会写进项目或发给别人');
  const activeId = catalog.activeId && items.some(item => item.id === catalog.activeId) ? catalog.activeId : id;
  writeJson(storage, META_KEY, {version: 1, activeId, items});
  writeJson(storage, KEYS_KEY, keys);
  return listPublic(storage);
}

export function updateEntryKeepingKey(input, storage) {
  const error = validateEntry(input);
  if (error) throw Error(error);
  const catalog = loadCatalog(storage);
  const keys = readJson(storage, KEYS_KEY, {});
  const id = String(input.id || '');
  const existing = catalog.items.find(item => item.id === id);
  if (!existing) return upsertEntry(input, storage);
  const incomingKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const now = Date.now();
  const next = {
    ...existing,
    name: String(input.name).trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: String(input.model).trim(),
    updated: now,
  };
  const items = catalog.items.map(item => item.id === id ? next : item);
  if (incomingKey) keys[id] = incomingKey;
  if (!keys[id]) throw Error('请填写 API Key。密钥只保存在这台浏览器，不会写进项目或发给别人');
  writeJson(storage, META_KEY, {version: 1, activeId: catalog.activeId, items});
  writeJson(storage, KEYS_KEY, keys);
  return listPublic(storage);
}

export function removeEntry(id, storage) {
  const catalog = loadCatalog(storage);
  const keys = readJson(storage, KEYS_KEY, {});
  const items = catalog.items.filter(item => item.id !== id);
  delete keys[id];
  const activeId = catalog.activeId === id ? (items[0]?.id || '') : catalog.activeId;
  writeJson(storage, META_KEY, {version: 1, activeId, items});
  writeJson(storage, KEYS_KEY, keys);
  return listPublic(storage);
}

export function setActive(id, storage) {
  const catalog = loadCatalog(storage);
  if (!catalog.items.some(item => item.id === id)) throw Error('找不到这个模型配置');
  writeJson(storage, META_KEY, {version: 1, activeId: id, items: catalog.items});
  return listPublic(storage);
}

export function activePublic(storage) {
  const list = listPublic(storage);
  return list.items.find(item => item.id === list.activeId) || null;
}

function isAdmin() {
  try {
    if (typeof Accounts !== 'undefined' && Accounts.current?.()?.role === 'admin') return true;
  } catch {}
  return !!document.querySelector('#accountStatus [data-account="admin"]');
}

function toast(message) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

let formState = {id: '', name: '', baseUrl: '', model: '', presetHint: ''};

function resetForm(preset) {
  formState = {
    id: '',
    name: preset?.name || '',
    baseUrl: preset?.baseUrl || '',
    model: '',
    presetHint: preset?.modelPlaceholder || 'agnes-3.0-flash',
  };
}

function startEdit(item) {
  formState = {
    id: item.id,
    name: item.name,
    baseUrl: item.baseUrl,
    model: item.model,
    presetHint: 'agnes-3.0-flash',
  };
}

function readForm(root) {
  return {
    id: formState.id,
    name: root.querySelector('[data-api-field="name"]')?.value || '',
    baseUrl: root.querySelector('[data-api-field="baseUrl"]')?.value || '',
    model: root.querySelector('[data-api-field="model"]')?.value || '',
    apiKey: root.querySelector('[data-api-field="apiKey"]')?.value || '',
  };
}

function renderPanel() {
  const back = document.querySelector('#modal');
  const body = document.querySelector('#modalBody');
  if (!back || !body) return;
  const list = listPublic();
  const editing = formState.id ? list.items.find(item => item.id === formState.id) : null;
  const keyHint = editing?.hasKey ? '已保存密钥。要更换就在这里重新粘贴；留空则保持原密钥' : '密钥只保存在这台浏览器，不会写进项目备份，也不会出现在聊天里';
  body.innerHTML = `
    <h2>切换 / 添加模型</h2>
    <p class="muted">给工作台添加 OpenAI 兼容接口。显示名可以叫「Agnes 国际版」，模型名必须用官方 id。</p>
    <div class="notice">付费 xAI 保持关闭。密钥由你自己填写，页面不会回显已保存的完整密钥。可添加多个配置，例如国际版和国内版各一份。</div>
    <div class="row wrap" style="margin-top:12px">
      ${PRESETS.map(p => `<button type="button" data-api-act="preset" data-id="${escapeHtml(p.id)}">填入${escapeHtml(p.name)}地址</button>`).join('')}
    </div>
    <div class="field"><label>显示名</label><input data-api-field="name" value="${escapeHtml(formState.name)}" placeholder="例如 Agnes 国际版" autocomplete="off"></div>
    <div class="field"><label>接口地址（Base URL）</label><input data-api-field="baseUrl" value="${escapeHtml(formState.baseUrl)}" placeholder="https://apihub.agnes-ai.com/v1" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>模型名（官方 id）</label><input data-api-field="model" value="${escapeHtml(formState.model)}" placeholder="${escapeHtml(formState.presetHint || 'agnes-3.0-flash')}" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>API Key</label><input data-api-field="apiKey" type="password" value="" placeholder="${editing?.hasKey ? '已保存，留空则不修改' : '在这里粘贴密钥，不要发到聊天'}" autocomplete="new-password"></div>
    <p class="muted">${escapeHtml(keyHint)}</p>
    <p class="form-error" data-api-error role="alert"></p>
    <div class="row wrap">
      <button type="button" class="primary" data-api-act="save">${editing ? '保存修改' : '添加这个模型'}</button>
      ${editing ? '<button type="button" data-api-act="new">改添加新的</button>' : ''}
    </div>
    <h3 style="margin-top:28px">已添加的模型</h3>
    ${list.items.length ? list.items.map(item => `
      <section class="section" style="margin-top:12px">
        <h4>${escapeHtml(item.name)}${item.active ? ' · 正在用' : ''}</h4>
        <p class="muted">模型 ${escapeHtml(item.model)}<br>地址 ${escapeHtml(item.baseUrl)}<br>${item.hasKey ? '密钥已保存在本机浏览器' : '还没有密钥'}</p>
        <div class="row wrap">
          ${item.active ? '' : `<button type="button" data-api-act="use" data-id="${escapeHtml(item.id)}">设为正在用</button>`}
          <button type="button" data-api-act="edit" data-id="${escapeHtml(item.id)}">改</button>
          <button type="button" data-api-act="delete" data-id="${escapeHtml(item.id)}">删除</button>
        </div>
      </section>
    `).join('') : '<p class="muted">还没有添加模型。可先点上面的地址按钮，再填写官方模型名和密钥。</p>'}
  `;
  back.style.display = 'flex';
  back.querySelectorAll('[data-api-act]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      onAction(btn.dataset.apiAct, btn.dataset.id);
    });
  });
}

function errorInPanel(message) {
  const el = document.querySelector('[data-api-error]');
  if (el) el.textContent = message || '';
}

function onAction(act, id) {
  try {
    if (act === 'open') {
      if (!isAdmin()) return toast('只有管理员可以添加模型');
      if (!formState.name && !formState.baseUrl) resetForm();
      renderPanel();
      return;
    }
    if (act === 'preset') {
      const preset = PRESETS.find(p => p.id === id);
      if (!preset) return;
      const root = document.querySelector('#modalBody');
      const current = root ? readForm(root) : formState;
      formState = {
        id: formState.id,
        name: current.name || preset.name,
        baseUrl: preset.baseUrl,
        model: current.model,
        presetHint: preset.modelPlaceholder,
      };
      renderPanel();
      return;
    }
    if (act === 'new') {
      resetForm();
      renderPanel();
      return;
    }
    if (act === 'edit') {
      const item = listPublic().items.find(entry => entry.id === id);
      if (!item) return;
      startEdit(item);
      renderPanel();
      return;
    }
    if (act === 'use') {
      setActive(id);
      renderPanel();
      toast('已设为正在用。成员看不到选择器');
      paintCenter();
      return;
    }
    if (act === 'delete') {
      if (!confirm('删除这个模型配置？密钥也会从这台浏览器里去掉。')) return;
      removeEntry(id);
      if (formState.id === id) resetForm();
      renderPanel();
      toast('已删除');
      paintCenter();
      return;
    }
    if (act === 'save') {
      const root = document.querySelector('#modalBody');
      const input = readForm(root);
      const listed = listPublic().items.find(item => item.id === input.id);
      const result = listed ? updateEntryKeepingKey(input) : upsertEntry(input);
      startEdit(result.items.find(item => item.id === (input.id || result.items[0]?.id)) || {id:'', name:input.name, baseUrl:input.baseUrl, model:input.model, hasKey:true});
      renderPanel();
      toast('已保存。密钥只留在这台浏览器');
      paintCenter();
    }
  } catch (err) {
    errorInPanel(err.message || '没有保存');
  }
}

function injectHeaderButton() {
  const host = document.querySelector('#accountStatus');
  if (!host) return;
  const existing = host.querySelector('[data-api-act="open"]');
  if (!isAdmin()) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const adminBtn = host.querySelector('[data-account="admin"]');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.apiAct = 'open';
  btn.textContent = '切换 / 添加模型';
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    onAction('open');
  });
  if (adminBtn) adminBtn.before(btn);
  else host.append(btn);
}

function paintCenter() {
  const page = document.querySelector('#main .page');
  if (!page) return;
  const heading = page.querySelector('h1');
  if (!heading || heading.textContent !== '从剧本到镜头。') {
    page.querySelector('[data-api-center]')?.remove();
    return;
  }
  if (!isAdmin()) {
    page.querySelector('[data-api-center]')?.remove();
    return;
  }
  const list = listPublic();
  const active = list.items.find(item => item.active);
  let box = page.querySelector('[data-api-center]');
  if (!box) {
    box = document.createElement('section');
    box.className = 'section';
    box.dataset.apiCenter = '1';
    page.append(box);
  }
  box.innerHTML = `
    <h3>自定义 OpenAI 兼容 API</h3>
    <p class="muted">${active ? `当前管理员选用：${escapeHtml(active.name)}（${escapeHtml(active.model)}）。成员看不到这个选择器，以后出图记录会写上来源。` : '还没有选用模型。点下面添加国际版或国内版配置。'}</p>
    <button type="button" class="primary" data-api-act="open">切换 / 添加模型</button>
  `;
  box.querySelector('[data-api-act="open"]')?.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    onAction('open');
  });
}

export function mountCustomApiModels() {
  if (typeof document === 'undefined') return;
  injectHeaderButton();
  paintCenter();
}

if (typeof document !== 'undefined') {
  const boot = () => {
    mountCustomApiModels();
    const header = document.querySelector('#accountStatus');
    const main = document.querySelector('#main');
    if (header && typeof MutationObserver === 'function') new MutationObserver(() => injectHeaderButton()).observe(header, {childList: true, subtree: true});
    if (main && typeof MutationObserver === 'function') new MutationObserver(() => paintCenter()).observe(main, {childList: true, subtree: true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
