# 诊断（隔离源码，未操作现站）

对照 2026-11-21 导出，并用 2026-11-24 live 哈希核对公开 JS。公开文件里 `accounts.mjs`、`app.mjs`、`custom-api-models.mjs`、`language-writing.mjs` 与导出一致。`providers.mjs`、`provider-settings.mjs`、`index.html` 比导出新，补丁不覆盖。

## 文字

`custom-api-models.mjs` 把 Agnes 配置和密钥放在本机 `jbp-custom-openai-models-v1` / `jbp-custom-openai-keys-v1`。导出的 `generationApi`、`language-writing.mjs`、`app.mjs` 拆镜提交都不读取这两把键，而是请求同域 `/api/generation`。`generation.ts` 再调用 `completeText`，默认基址是 `https://api.x.ai/v1`。

补丁后，`status` / `jobs` / `job` / `submit` 走 `custom-text-lane.mjs`。有激活配置时请求该配置的 `/chat/completions`，返回正文，并用同一任务 id 支持随后的 `job` 轮询。没有配置时抛出「未配置自定义模型」，不发请求。`api.x.ai`、`x.ai`、`api.x.com` 以及带尾点、大小写、Unicode 点、`api.x.ai.evil.com` 这类别名会被拒绝。密钥只出现在当次 `Authorization` 头，不进入返回值、任务记录或项目 JSON。

服务端 `/api/generation` 的 submit 固定 409「未配置自定义模型」，不再调用 `completeText`。`studio.server.ts` 里的镜本 `parseAssets` 仍引用 `xai-studio.ts`，工作台 `generationApi` 不走那条函数。这次没有改它。

## 图片和视频 500

`POST /api/images?action=generate` 的空对象原先直接进入 `submitMemberJob`。空 prompt 的明确 400 写在 `pianchang-still` / `pianchang-video`，没有写在 images generate。异常若是名为 `HTTPError`、消息也是 `HTTPError`，框架会变成 500 `unhandled`。

`GET /api/pianchang-video` 无 id 时，`readMemberJob` 先跑 `memberQueueGate` 再判断空 id。闸门或数据库抛错时，空 id 到不了 400。

补丁在进队列前返回 400「没有画面要求」或「没有这条任务」，并把 `HTTPError` 收成 400/401/404 JSON。带 `memberId` 的任务，其他会员读到 404，未登录读到 401。没有归属字段的旧行仍按原查询返回，因为导出里的 SQL 没有会员列；新的提交会把 `memberId` 放进 payload。若线上 `studio_image_submit` 丢掉未知字段，归属写不进去。这要在 Grok 项目里核对函数体，本包没有该 SQL。

全站出图 choice 未改。测试没有向 Grok 会员队列提交。

## 409 后的自动保存

`app.mjs` 第 71 行：本地保存修订号追上时调用 `scheduleVault`。第 163–164 行：1.4 秒后 `pushVault`，先 `vault-save`，再 `project-save`，修订号用 `P.cloudRevision`。

`project-save` 返回 409 且正文里带 `revision` 时，原实现执行：

`P.cloudRevision = Number(data.revision)`

本地正文不变。下一次自动保存就带着服务端新修订号和仍旧的本地正文。`saveMemberProject` 在修订号相等时会写入并加一。因此 409 之后的下一次自动保存可以覆盖较新的云端正文。这个路径成立。

手动上传 `uploadLocalProject` 遇到 409 只提示，不改修订号。危险赋值在自动 `pushVault`。

补丁：

- 409 只记下 `cloudConflict`，`cloudRevision` 保持冲突前的本地值。
- `cloudConflict` 未解除时，后续自动保存直接返回，不再发 `project-save` 或 `vault-save`。
- 同一次尝试里，`project-save` 成功之后才发 `vault-save`。409 和 403 都不会接着写 vault。
- `resolveConflict(..., "use-local")` 不发送。显式选择 `keep-cloud` 也不上传。
- 用户打开云端项目时，本地文档换成下载到的云端文档，并清掉冲突。这是下载，不是用旧正文回写。

两个客户端的负例在 `tests/conflict-and-members.test.mjs`：甲写入后乙收到 409，乙的下一次自动保存 `sent:false`，库内正文仍是甲的。把修订号改成服务端值再保存，模拟器会写入，用来说明原风险。另一手机号即使带上匹配的修订号也是 403，正文不变。修冲突没有放宽归属。

`cloudRevision: 4` 不能证明这份正文已经成功进云端。自动保存每次成功都会加修订号；旧的 409 处理也会把服务端修订号抄到本地。新空工程没有点过手动云存，导出里仍可能出现 4。`revisionProvesStoredBody()` 固定返回 false。

## 403

现有 console 只有状态码 403，没有 method、action 或响应 JSON，而且发生在新建工程之前。不能把它归到这次新建，也不能据此说整段登录失效。各 action 的状态码和前端触发点见 `bench-members-403.md`。

## 会员库

登录后的 `adoptDurableProjects` 会把访客库非种子工程按原 id 抄进会员库，无前缀 `jbp-active` 会参与任何账户的当前工程选择。补丁让 `shouldCopyGuestLibrary` 返回 false，会员范围不再使用那把旧键。已在会员库里的工程不删除、不改写。负例保持 EP02 的剧本和 8 个资产不动，也不把桂花选成当前。

## 独立视频页

导出的独立视频页用 `mediaHTML(asset)` 画缩略图，只看 `src`。云端打包把超长图换成空 `src` 加 `imageLibraryId` 之后，缩略图是空的。提交又只接受 `data:image/` 或 `http(s)` 的 `src`，图库里的像素不会进请求。页面要求响应里的 `requestId`，会员队列返回的是 `jobId`，并且这次请求没有会员头。

补丁只动这一页。缩略图和提交都走 `video-page-refs.mjs`：有可读 `src` 用 `src`，否则只读 `galleryDataUrl(imageLibraryId)`。同一条像素既显示又提交。读不到就在提交前停下，请求列表为空。图生视频和全能参考只发 1 张，首尾帧只发 2 张，多参考图最多 14 张，文生视频不发图。11 张可读不会因此变成 11 张发送。choice 不是 `grok` 或读不到时不入队，不改全站 choice，也不选 `api.x.ai`。轮询认 `jobId`，成功必须有产物。

画布视频节点、片场提示词字段、白模分镜链和本机大图库的存放方式都没有改。没有跨账号复制。

## 仍要在 Grok 项目里核对

- 后端源文件是否仍是 2026-11-21 导出的前置哈希。现站后端是编译结果，源哈希未核。不是就停止，不要覆盖。
- 真实文字、图片、视频产物未验。不要把这份契约测试当成现站已生成成功。
- `studio_image_submit` 是否保留 payload 里的 `memberId`。
- 镜本 `studio.server.ts` 的 `parseAssets` 仍可能走 xAI，工作台文字补丁不覆盖那条调用。
