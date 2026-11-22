# 线控运镜插件

这是一份可复制到 MuseCanvas 插件目录的独立 ESM 插件。它不修改、不替换 `index.html` 里的主包 `/assets/index-jubaopeng-v3.js`，也不覆盖 `plugins/jubaopeng-storyboard.js`。

本仓库没有装上本机 `/Users/lixin/MuseCanvas/web`。下面的路径是接入说明，不是已安装声明。隔离页面 `integrations/musecanvas/harness.html` 用一份测试用 runtime 加载同一份 `register`，用来验收画线、编辑、预演、导出和重开。

## 它做什么

- 在节点面板里手绘、逐点添加、拖动图像平面上的路线，标出起点、终点和方向。
- 调整时长、速度和机位离画面的距离。速度只改时长，不改图像上的点。
- 播放、暂停、拖动时间轴，并从结尾再次播放时回到起点。
- 导出本地白模预演 WebM、首/中/尾 PNG，以及可再次导入的路线 JSON。
- 点「保存路线」后，只向当前节点提交 `{lineCamera}`。重开面板从 `node.metadata.lineCamera` 读回。

默认不调用 `ctx.ai`、`ctx.applyOps` 或任何生成接口。面板里没有生成按钮。

## 2D 笔画和 3D 机位不是一回事

图像上的线保存在 `imageStroke`，坐标是画面上的 `u` / `v`（0 到 1）。它不是摄影机位姿。

三维机位是固定换算，模型名 `board-normal-standoff`：

- 参考图直立在白模房间里，宽 6 米、高 3.375 米，底边高度 0.7 米，位于 z = -3。
- 每个笔画点先变成画面上的注视点。
- 摄影机放在该点正前方 `standoff` 米（默认 4，可调 1–12），焦距固定 35mm，横滚为 0。
- 沿这条折线的路程匀速走完设定时长。反向只改变取样顺序，不改已保存的点序。

这条换算不是 LibTV 的源码或资产，也不是生成模型返回的轨迹。文字提示词和缩放不会被写成轨迹。虚拟片场里已有的关键帧运镜、以及片场页北/西/东/南静态机位，都是另一套数据，这个插件不读写它们。

空路线和单点可以留在草稿里，但不能播放或导出。过短手绘、越界点和非法 JSON 会拒绝，并保留上一条有效路线。

## 构建产物

没有打包步骤，也不生成新的主 bundle。下面这些文件就是产物，浏览器按相对路径加载：

| 仓库路径 | 复制到宿主 `web/plugins/` |
| --- | --- |
| `integrations/musecanvas/plugins/jubaopeng-line-camera.js` | 是，登记这一条 |
| `integrations/musecanvas/plugins/jubaopeng-line-camera-boot.js` | 是，可选 |
| `integrations/musecanvas/plugins/line-camera-core.mjs` | 是 |
| `integrations/musecanvas/plugins/line-camera-preview.mjs` | 是 |
| `integrations/musecanvas/plugins/line-camera-editor.mjs` | 是 |
| `integrations/musecanvas/harness.html` | 否，只用于本仓库隔离测试 |
| `docs/line-camera.md` | 否 |

插件 id 是 `jubaopeng-line-camera`，节点 type 同名，版本 `1.0.0`。

## 初始化与销毁

`register(runtime)` 是初始化。它只检查 `runtime.jsx`、`runtime.React.useEffect`、`runtime.React.useRef`，尝试调用可选的 `injectCSS`，然后返回描述对象。它不写 localStorage，不挂定时器，不改 `window` 上的其他插件。

返回值：

```js
{
  id: 'jubaopeng-line-camera',
  name: '线控运镜',
  version: '1.0.0',
  description,
  css,
  nodes: [{ type, title, Content, Panel }],
  setup() { return function dispose() {} }
}
```

`runtime` 也可由宿主挂在 `window.InfiniteCanvasRuntime`。插件自己不创建这个全局对象。

`setup()` 返回的 `dispose` 目前没有全局监听，调用一次或多次都是空操作。真正要释放的是面板：

- `Panel` 在 `useEffect` 里调用 `mountLineCamera`。
- effect 的清理函数调用 `handle.destroy()`。
- `destroy()` 可重复调用。它停止播放、放弃尚未完成的录制、清空挂载节点，不再改路线数据。
- 宿主卸载面板或换节点 id 时都会走到这条清理。

`Content` 不启动编辑器。它只显示点数、时长，并在宿主提供 `ctx.openPanel` 时放一个「编辑线控运镜」按钮。

保存时调用 `ctx.updateMetadata({lineCamera})`。这里只带一个字段，按现有面板的补丁合并来用。如果某个宿主把 `updateMetadata` 实现成整份替换，会丢掉该节点上的其他 metadata；接入前要确认它是合并。插件不用 `applyOps`，所以不会改别的节点。

## 非破坏性接入

只追加，不替换已有 boot 和主脚本。`official-plugins.json` 是官方目录，不要把它当成自动加载清单，这个插件也不写进那个文件。

`plugins/index.json` 是 URL 数组。在数组末尾追加插件入口，保留原来的 `jubaopeng-storyboard.js`：

```json
[
  "/plugins/jubaopeng-storyboard.js",
  "/plugins/jubaopeng-line-camera.js"
]
```

仅登记不会自动启用，宿主默认 `enabled: false`。可选 boot 用来补上第一次启用，且只在 localStorage 键 `infinite-canvas:plugin_store` 里还没有 `jubaopeng-line-camera` 时写入 `{enabled: true, local: true}`。用户关掉之后，这个 id 已经存在，boot 不会再打开它。JSON 损坏或形状无法识别时，boot 不覆盖原值。

在 `index.html` 里已有脚本之外追加一行，放在主包脚本旁边即可，不要改 `/assets/index-jubaopeng-v3.js` 的 script 标签：

```html
<script type="module" src="/plugins/jubaopeng-line-camera-boot.js"></script>
```

宿主入口仍是先加载它自己的 boot，再加载 `/assets/index-jubaopeng-v3.js`。本插件的 boot 只负责那一次 localStorage 播种。

复制到 `web/plugins/` 时要保持这五个运行文件在同一目录，因为入口用相对路径 import 核心、预演和编辑器。

## 部署

本仓库的 GitHub Pages 只在推送到 `main` 时发布 `pages/` 目录。这条功能分支不推 `main`，不合并，也不发布。插件放在 `integrations/musecanvas/`，不会进入现有的 Pages 复制清单，也不会改部署工作流的触发条件。验证工作流仍可能在 pull request 上跑测试，那不是对外发布。

## 验收范围

自动测试覆盖空路线、单点、越界、过短手绘、时长、速度、反向、暂停后时间不走、播完再播、JSON 往返、metadata 只改 `lineCamera`、boot 不强制重新启用，以及 `register` 不调用 `ctx.ai`。

隔离页用 Chrome 打开 `harness.html`，走绘制、拖点、改时长、暂停、保存、重开、静帧和路线重载。这个页面不是本机 MuseCanvas 0.23.3，也没有加载 `index-jubaopeng-v3.js`。WebM 是否真正写出取决于该浏览器的 `MediaRecorder`；失败时静帧和 JSON 仍然可用，结果里会单独写明。
