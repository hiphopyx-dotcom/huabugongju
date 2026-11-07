# 预览站画布：编号、参考图和对照

这份说明给正在维护 `https://zinc-raven-rocket-drift.grok.me/bench/` 的人。不要把它整份覆盖到线上，也不要因此重跑 `scripts/export-bench.mjs` 去替换正在用的 `/bench`。

线上的 `/bench` 是一份改过的静态导出，和仓库里的 `pages/app.mjs` 已经不是同一份文件。仓库里的 `pages/` 没有 `stampSeq`，也没有图片节点的 `siteStill`。生产用的 `public/studio` 同样没有这条路径。这次没有改生产目录，没有部署，也没有动用户项目里的图片。

## 和仓库的差异

线上快照里能对上的问题：

- `app.mjs` 的 `siteStill` 在拿到 `dataUrl` 之后调用 `seq-stamp.mjs` 的 `stampSeq`，把 `seqLabel` 画进像素。
- 同一函数把不是 `data:` 的参考滤掉，再 `slice` 到 3 张或调用方传入的 4 张。
- `image-node.mjs` 的 `requestBody` 会把非 `data:` 的 `src` 清成空字符串。
- `shot-stage-still.mjs` 的 `orderRefs` 按人物、场景、道具重排，再切到 3 张。
- `imageRefs` 和钉白模时的 `assetIds` 也会直接切到 3 张。
- 角色只出现在提示词里。预览没有“即将发送的图”和“上一张结果”。

本仓库能核对到的图片接口是 `deploy/lib/images.mjs`：

- 最多 3 张参考。
- 每张是 `{id}` 或 `{dataUrl}`。`dataUrl` 只能是 PNG、JPEG、WebP，解码后不超过 768KB。
- 没有 `role`，没有 `seed`，服务端也不按网址去拉参考图。

`/api/pianchang-still` 不在这个仓库里。线上现在发送的正文是 `prompt`、`aspect`、`resolution: '1k'`、`refs`（图片数据字符串）、`projectId`、`projectName`、`name`、`entityKind`、`shotNo`。补丁保持这些字段，不新增字段。调用方原有的 `refCap: 4` 仍可发出 4 张，但页面会写明：超过 3 张没有被本仓库的图片接口验证。

第三方 Seedance 适配器里的“首尾帧不能和多模态参考混用”没有在剧爆棚这条接口上核对过，所以没有加模式互斥，也没有加新的张数或种子能力。

## 不要这样更新

不要用 `node scripts/export-bench.mjs` 的输出覆盖线上 `/bench`。那会用仓库里较旧的 `pages/app.mjs` 换掉现在这份画布。正在用已有图片做第一集的人会失去这份画布。已生成的图也不要重写或删除；补丁只影响下一次发送。

## 可以这样合入

在线上 `/bench` 目录、且没有人正在点生成时：

1. 先备份这一份 `app.mjs`、`image-node.mjs`、`seq-stamp.mjs`、`shot-stage-still.mjs`。
2. 确认它们和做补丁时的快照一致。`docs/zinc-bench-still-refs.patch` 可以用 `patch --dry-run -p1` 试。对不上就不要硬套，只抄下面这几处。
3. 拷入本仓库的三个新文件，不要改名：
   - `pages/seq-stamp.mjs`
   - `pages/still-refs.mjs`
   - `pages/still-preview.css`
4. 应用补丁，或按下面的行为手工改。
5. 在 `index.html` 里给 `still-preview.css` 加一个样式链接。
6. 用色块样例看预览。不要为了验收去打真实出图。

只换 `seq-stamp.mjs` 也能先停掉盖章：`stampSeq` 现在把原字符串原样返回。编号要等 `siteStill` 把 `seqLabel` 放进结果的 `metadata`，角标才会出现。已经进项目的旧图不会被打开重画。

## 发送时的行为

`siteStill` 先做 `planStillReferences`。规划器自己不调用 `fetch`。只有 `blob:`、站内路径，或和 `location.origin` 完全相同的地址，才会交给原来的 `stillDataUrl`。`file:`、`javascript:`、内网地址和其他网站会直接失败，后面的参考也不会悄悄发出去。

规划失败时，这次生成停住，任务记失败，提示写明是哪一张。`discard` 仍只丢掉这一次新产生的图，上一张结果还在。重试按钮走原来的 `image-generate`，不新开接口。

对象形式的参考会把顺序和角色写进提示词，例如 `<IMAGE_1>` 对上第二张。字符串形式的参考不追加这几句，避免改掉白模关键帧原来的提示词。图片接口那条形状只在 `wire: 'images'` 时组 `{id}` 或 `{dataUrl}`；一张图同时带编号和图片数据时不替调用方选择。

`orderRefs` 不再重排、不再截断。`enrichCanvasPrompt` 如果还有人调用，角色句和白模句会用这张图自己的序号。画布发送改走 `appendRefPrompt`，不要两套一起叠到同一次提示词上。

## 样例

仓库里的 `pages/still-preview-fixture.html` 用四块纯色样例演示即将发送的顺序、角标编号、失败后仍留着的上一张，以及外部地址让整单停住。它不读取密钥，也不提交出图。测试不能说明真实模型更稳定，只说明字节、顺序、失败和重试状态按上面的规则变化。
