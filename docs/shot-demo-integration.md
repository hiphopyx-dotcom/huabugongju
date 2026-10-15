# 原分镜模型演示接入

分镜管理中的景别、机位、构图、运镜演示复用 `hiphopyx-dotcom/sunny-terra` 提交 `d0daeebb40009982b84a043e8dc2f8811134d23e` 的 `src/lib/shot-rig.ts` 与 `src/components/shot-stage-3d.tsx`。

- `public/studio/shot-rig.mjs`：原机位、运动类型和中文教学说明的 JavaScript 版本。
- `public/studio/shot-stage.mjs`：原 `createWorld` 和辅助几何函数，去除 React 外壳，以 Three.js 0.185.1 打包为独立 ES 模块。
- `integrations/shot-software-renderer.mjs`：优先 WebGL；浏览器禁用 WebGL 时用 Three.js SVGRenderer 投影同一场景和摄影机，并保留动画、导演位与取景双画面。兼容模式的鱼眼以圆形裁切近似，无法复用 GPU 畸变着色器。
- `public/studio/three-LICENSE.txt`：Three.js MIT 许可证。
- `public/studio/shot-guide.mjs`：工作台的选择、演示、确认应用与资源释放适配；两种渲染器均无法启动时明确提示并显示 SVG 机位示意。

光影、风格化和特殊摄影复用原工坊公开的 `/shot-guide/` 示例图片；滤镜类选项沿用原 `shot-picker.tsx` 的对照方式。这些示例为镜头教学演示，不是当前项目已生成的画面，也不调用生成 API。

应用选择只更新指定分镜对应字段；项目风格锁、人物/场景/道具参考、首尾帧及正反打参数保持原有保存与任务传递逻辑。
