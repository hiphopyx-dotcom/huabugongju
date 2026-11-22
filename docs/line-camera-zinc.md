# zinc 测试站核对（2026-11-22）

MuseCanvas 插件 `jubaopeng-line-camera` 没有接到 zinc。本文件只记录公开页面上能核对到的事实，以及在改 zinc 之前必须补齐的宿主契约。没有把线上的打包文件写回仓库，也没有改 `public/studio`、正式站或 sunny 母版。Vercel 预览按用户要求不再重试。

## 两个宿主

| | 本机 MuseCanvas | zinc 测试站 |
| --- | --- | --- |
| 位置 | `/Users/lixin/MuseCanvas/web`，另有人在装 | `https://zinc-raven-rocket-drift.grok.me` |
| 本次是否在该宿主里画过线 | 否。隔离页不是这台机器 | 否。未登录，没有进入具体一集的画面 |
| 入口 | `index.html` 先 boot，再 `/assets/index-jubaopeng-v3.js` | React 路由，主包 `/assets/index-C2J1yR0k.js` |
| 扩展方式 | `export default function register(runtime)`，`plugins/index.json` | 公开包里没有 `register`、`plugin`、`InfiniteCanvas` |
| 本仓库有没有对应源码 | 插件在 `integrations/musecanvas/`，宿主源码不在本仓库 | 下面这些打包文件的源码不在本仓库 |

仓库里的 `public/studio/index.html` 加载的是 `app.mjs`，标题是「剧爆棚 · 创作工作台」。测试站 `/studio` 的标题是「剧爆棚」，正文是「正在进入片场…」，脚本是带内容哈希的 Vite 包。请求 `/studio/app.mjs` 和 `/studio/canvas-ui.mjs` 返回的仍是这页 HTML，不是仓库里的那两个模块。所以不能把 `public/studio` 的节点画布当成当前 grok.me 片场。

## 2026-11-22 从测试站读到的包

匿名读取，没有账号，没有下发登录态。

- 页面项目标记：`grok-project-id` = `01a1855e-24f5-77e3-9bc5-fda0059277d8`
- `/assets/index-C2J1yR0k.js`，432612 字节，sha256 前缀 `882de73f5cfecb4c`
- `/assets/studio-Bys5fsK4.js`：`/studio` 的登录壳。未登录时转到 `/login?e=进片场时没有登录状态`
- `/assets/studio-B_cwBFps.js`：`/studio/` 的剧本列表。可见文案包括「片场」「拆解和出图会自动存到本机快照」「打开《夜渡》示例」
- `/assets/_episodeId-D8Lhqh2U.js`，658179 字节，sha256 前缀 `800453e5a3cb`。这是 `/studio/$projectId/$episodeId` 的页面包

路由名出现在主包里：`/`、`/download`、`/login`、`/studio`、`/studio/`、`/studio/new`、`/studio/team`、`/studio/$projectId`、`/studio/$projectId/`、`/studio/$projectId/$episodeId`。

集页面包里能数到「运镜」14 次、「机位」25 次、「镜头」149 次，并且带有 Three.js 的 `BufferGeometry` / `Texture` 序列化字样。同一包里「画布」「节点」「线控」「plugin」「InfiniteCanvas」都是 0 次。`canvas` 只出现在制图和 WebGL 上下文里，不是节点画布 API。保存相关可见文案是「保存剧本」「本集剧本已保存」「保存到电脑」「顺序没保存」，没有线控路线字段。

这些哈希下次构建就会变。它们只证明本次看到的版本，不是稳定契约。

## 还缺什么，才能做增量接入

在拿到下面这些之前，不改测试站上的旧包，也不在本仓库里猜一个保存格式。

1. 构建出 `index-C2J1yR0k.js`、`studio-B_cwBFps.js`、`_episodeId-D8Lhqh2U.js` 的源码树，以及它和 grok 项目 `01a1855e-24f5-77e3-9bc5-fda0059277d8` 的对应关系。本仓库搜不到这些文件名，也搜不到「正在进入片场」。
2. 登录后的一集画面里，真正要画线的那一块是什么。当前公开包没有节点画布字样。要确认是集页面里的 Three 视图，还是另一个尚未出现在这个构建里的表面。
3. 宿主是否已经有「额外脚本」或插件入口。目前看不到。不能靠替换 `index-C2J1yR0k.js` 或 `_episodeId-*.js` 来塞功能。
4. 路线要写进哪里。需要现成的项目或本集保存接口、字段名，以及旧剧本/旧图是否原样保留。可见文案只说明剧本和图片会进本机快照，不能据此发明字段。
5. 用测试站账号打开 `/studio/$projectId/$episodeId`，看实际 DOM 上有没有稳定挂载点。匿名请求进不了这一步。

仓库里已经有的、和 MuseCanvas `register` 无关的部分，是 `integrations/musecanvas/plugins/line-camera-editor.mjs` 的 `mountLineCamera` / `destroy`。它只负责画线、预演和导出，不调用模型。等上面 1–5 有了实文件和实接口，再把它挂到那个宿主的增量入口上。在那之前，zinc 测试站不算已支持。

## 本次没有做的事

- 没有重试 Vercel，没有处理账号解封。
- 没有改正式站、sunny 母版、线上哈希包。
- 没有把 MuseCanvas 插件登记写成 zinc 的接入。
- 没有在本机 `/Users/lixin/MuseCanvas/web` 上复测。那一步仍由正在安装插件的人做。
