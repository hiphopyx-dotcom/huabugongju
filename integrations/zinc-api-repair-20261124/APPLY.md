# 2026-11-24 zinc-raven API 隔离补丁

这是给 Grok 项目 `01a1855e-24f5-77e3-9bc5-fda0059277d8` 的增量补丁包。本仓库 PR 只存放补丁、新模块、契约测试和说明。它没有安装到 zinc-raven，没有发布，也没有做真实文字、图片或视频生成。

## 应用

在 Grok 项目根目录执行，不要对 GitHub `main` / `zinc` 整包覆盖：

```bash
node integrations/zinc-api-repair-20261124/apply.mjs --root /path/to/grok-project
```

脚本先核对前置 SHA-256。哈希一致才改对应文件；已经是补丁后哈希则跳过。`app.mjs` 若仍是上一轮补丁后的 `f2d64152e2bc0143375d9ecd8de5b6e1da38948d62f08ba5838783b73f4c332d`，只续接独立视频页片段，不重放前面的片段。其它哈希、目标片段不是恰好一处，或 `providers.mjs` / `provider-settings.mjs` / `index.html` 被改动时，脚本拒绝并退出码 2。替换按字面写入，片段里的 `$$` 不会被当成替换符。不要加强制开关。

`modules/public/bench/custom-api-models.mjs` 是补丁后的测试参照，供单测 import。apply 不会用它覆盖项目里的同名文件，项目文件只做片段替换。

## 会改的路径

| 路径 | 前置哈希 | 补丁后哈希 |
|---|---|---|
| public/bench/accounts.mjs | 0cd9668f6dd9e50a0c00fe1ef92abb6f8153e53519ce1b750300eb0c126ce87a | 92063405c63365a5e80e9509211d9e169ed1a6afdbc0bc605b6dc9b6dcd569ba |
| public/bench/custom-api-models.mjs | 24ceca8b2a1e49bd9998b6607c12b27b8bf5799b2703aa79803b4f4f4216f183 | 6ac169bf4d6dbff84fde9efe61040c5a308c66f10ba48081638ad55d734c9ce4 |
| public/bench/app.mjs | f6a1d2f8751eb717a9a3ba8a126010cae602df1da45e47df3708755361186145 | 3c7c7a5f54a790287d3468bf7a00e1a20a8f8a2b4d2f62ec55e8ec23551d01b3 |
| public/bench/project-selection.mjs | 56effda9ff617bf08b990684e1fad654d590046faf00e9e33fbd0d982cbdbd20 | 见新文件 |
| src/routes/api/generation.ts | 127f8ef80a7f2e7599cfd1594057fb059fae2a21b2df5fec62342072b45b0f96 | 见新文件 |
| src/routes/api/images.ts | c27544aa85bcf4f4ea6b6c395f184561dbf319785d167319cb9481de1dd1d091 | 见新文件 |
| src/routes/api/pianchang-still.ts | 9317766ea1f1fcf321e503a0564e6179e1616ab58a58b9f1d07ac9c41bea1e0a | 见新文件 |
| src/routes/api/pianchang-video.ts | f30e193e2af04f77af5ef240dc8cfba60cdf447529bf61e7ece5eac999d06bab | 见新文件 |
| src/lib/image-provider.server.ts | cc06e615a7d98fd1fad82b229608df4c16173c27e395cd8bb8f3a7c92402dd21 | aa6c495d28a515bd67deeb4d28c98e4c75aaf2afe66b51ca14a470070b202d26 |
| src/lib/bench-vault.server.ts | 2601638897407f8fe73e9ad4faddabf88df54f14000ba9b4282ccaaf2a8cd4fb | 094388a7c9426670b0bf7e181533059788f6103be40bae5994e78a641ea12348 |

新文件：`public/bench/custom-text-lane.mjs`、`provider-block.mjs`、`guest-adopt-guard.mjs`、`cloud-conflict.mjs`、`video-page-refs.mjs`，以及 `src/lib/workbench-text-guard.ts`、`media-route-guard.ts`、`bench-vault-guard.ts`。

不改：`providers.mjs`、`provider-settings.mjs`、`index.html`、全站出图 choice、部署配置、环境变量、数据库。现站 live 的 `providers.mjs` 哈希是 `4e18dae597c51007bd42c0db060c239aff87db92f438680b68fcfe57d77714e0`，`provider-settings.mjs` 是 `2ab02e1205b5a17d39ced3b2de2b9fc1c20746e3988cff78ae0d169da568e141`，`index.html` 是 `e58b2a693a39cfde6801f897d403a36fa838864cadd6882b1746cb9fee9c9799`。这三份比 2026-11-21 导出新，补丁不覆盖它们。

后端前置哈希来自 2026-11-21 导出。现站后端是编译结果，无法对二进制复核。若 Grok 项目里的上述源文件哈希已变，apply 会拒绝。以项目内文件为准，不要用这份导出硬盖。

## 测试

在本仓库执行：

```bash
node --experimental-strip-types --test integrations/zinc-api-repair-20261124/tests/*.test.mjs
```

2026-11-24 在隔离副本上 25 项通过。另在导出副本上跑过 apply：从原始哈希一次写完，从上一轮 `app.mjs` 哈希续接后与之相同，再执行一次为已应用跳过。测试使用合成图库，没有访问 api.x.ai、Agnes、Grok 队列或现站。

临时副本核对：`generation.ts` 不再调用 `completeText`；`pushVault` 不再在 409 时改 `cloudRevision`；`providers.mjs` 与导出逐字节相同。

## 独立视频页

只改独立视频页的选图、提交和轮询。画布上的视频节点仍走原来的 `runVideoNode`。图库只读本机已有的 `galleryDataUrl(imageLibraryId)`，不迁移 `jbp-desk-images`，也不把图复制到别的账号。片场写进提示词、比例、时长、分辨率和声音的字段仍用原来的 `videoTaskData`。白模分镜链不改。

实际会发送的张数：

| 方式 | 发送 |
|---|---|
| 文生视频 | 0 张图 |
| 图生视频、全能参考 | 1 张 |
| 首尾帧 | 首帧和尾帧 2 张 |
| 多参考图 | 勾选的图，最多 14 张（与 `pianchang-video` 对 `reference_images` 的截断相同） |
| 参考视频 | 1 条视频 |

11 张都能从合成图库读出时，图生视频不会把 11 张放进请求；多参考图只有被勾选且能读出像素的才会进入 `reference_images`，并且和缩略图是同一条像素。读不出像素时，在 `POST /api/pianchang-video` 之前报错。出视频方式不是已有会员队列 `grok`，或 choice 读不到时，不入队，也不改全站 choice，也不改去 `api.x.ai`。

提交带 `x-jbp-member` / `x-jbp-phone`。响应优先用 `jobId`，没有 `jobId` 才用 `requestId`。轮询是 `GET /api/images?action=job&id=&kind=video`。`done` 且有 `dataUrl` 或 http(s) 地址才算成功；`failed` 和 `done` 但没有产物都是终态失败。

## 还没做的真实验收

见 `ACCEPTANCE.md`。HTTP 200、`queued:true`、`cloudRevision` 数字都不能当成生成成功或云端保存成功。现站后端源哈希未核。真实文字、图片、视频产物未验。这次不申请、不触发安装或发布。
