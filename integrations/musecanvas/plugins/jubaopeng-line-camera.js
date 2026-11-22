// MuseCanvas plugin. Default export is register(runtime).
// This file does not replace the host bundle or any other plugin,
// and it does not call a model.
import {DISCLAIMER, PLUGIN_ID, createRoute, embedRoute} from './line-camera-core.mjs';
import {EDITOR_CSS, mountLineCamera, readInitialRoute} from './line-camera-editor.mjs';

export const id = PLUGIN_ID;
export const version = '1.0.0';

const CARD_CSS = EDITOR_CSS;

function upstreamImage(ctx) {
  let nodes = [];
  try { nodes = ctx?.getUpstream?.() || []; } catch { return ''; }
  if (!Array.isArray(nodes)) return '';
  for (const node of nodes) {
    const src = node?.metadata?.src || node?.src || node?.data?.src;
    if (typeof src === 'string' && /^data:image\/(png|jpeg|webp|gif);/i.test(src)) return src;
  }
  return '';
}

export default function register(runtime) {
  const rt = runtime || globalThis.InfiniteCanvasRuntime;
  if (typeof rt?.jsx !== 'function' || typeof rt?.React?.useEffect !== 'function' || typeof rt?.React?.useRef !== 'function') {
    throw Error('线控运镜插件需要 runtime.jsx、runtime.React.useEffect 和 runtime.React.useRef');
  }
  try { rt.injectCSS?.(CARD_CSS); } catch { /* CSS injection is optional; the editor also inserts its own style. */ }
  const h = (type, props, ...children) => {
    const next = props ? {...props} : {};
    if (children.length) next.children = children.length === 1 ? children[0] : children;
    return rt.jsx(type, next);
  };

  function Content(ctx) {
    const initial = readInitialRoute(ctx?.node?.metadata);
    const count = initial.route?.imageStroke.points.length || 0;
    return h('div', {className: 'jbp-lc-card', 'data-lc-card': '1'},
      h('strong', null, '线控运镜'),
      h('p', {'data-lc-card-state': '1'}, initial.invalid ? '路线数据无法读取' : count ? `${count} 个图像点 · ${initial.route.duration} 秒` : '尚未画线'),
      h('small', null, '2D 图像笔画 + 本地白模机位。不调用生成。'),
      typeof ctx?.openPanel === 'function' ? h('button', {type: 'button', 'data-lc-open': '1', onClick: () => ctx.openPanel()}, '编辑线控运镜') : null
    );
  }

  function Panel(ctx) {
    const ref = rt.React.useRef(null);
    const ctxRef = rt.React.useRef(ctx);
    ctxRef.current = ctx;
    rt.React.useEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      const live = ctxRef.current || {};
      const initial = readInitialRoute(live.node?.metadata);
      const handle = mountLineCamera(el, {
        route: initial.route || createRoute(live.node?.metadata?.duration || live.node?.duration || 5),
        imageSrc: upstreamImage(live),
        bindingLabel: live.node?.id ? `节点 ${live.node.id}` : '未绑定节点',
        notice: initial.invalid ? '节点上的路线无法读取，未覆盖原数据。保存后才会写入 lineCamera。' : '',
        onSave(route) {
          const current = ctxRef.current || {};
          const metadata = embedRoute(current.node?.metadata, route);
          current.updateMetadata?.({lineCamera: metadata.lineCamera});
        }
      });
      return () => handle.destroy();
    }, [ctx?.node?.id]);
    return h('div', {ref, className: 'jbp-lc-panel', 'data-lc-panel': '1'});
  }

  return {
    id: PLUGIN_ID,
    name: '线控运镜',
    version,
    description: DISCLAIMER,
    css: CARD_CSS,
    nodes: [{type: 'jubaopeng-line-camera', title: '线控运镜', Content, Panel}],
    setup() { return function dispose() {}; }
  };
}
