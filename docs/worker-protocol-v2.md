# 出图工作端协议 v2

这份协议给 Mac 上的 Grok 会员出图端，以及任何一个要自建队列的站点（包括另一个 Remix 站）。v1 的连接文件和「纯出图」任务保持原样。没写到的字段不要发明。

本站实现见 `deploy/lib/image-worker.mjs`。新字段放在原有的 `jsonb` 里，没有改旧列、没有删数据。

## 兼容

连接文件格式仍是 `jbp-mac-image-worker-v1`：

```json
{
  "format": "jbp-mac-image-worker-v1",
  "origin": "https://站点主机",
  "workerId": "primary",
  "workerToken": "43 位 URL 安全字符"
}
```

- `origin` 必须等于 `new URL(origin).origin`，只允许 `https`，不能带路径、查询、用户名或通配符。
- 本站签发的 `workerId` 仍是 `primary`。工作端只接受这个值。
- 不带 `type` 的任务就是 v1 出图任务，字段只有 `id`、`lease`、`prompt`、`ratio`、`resolution`、`references`。`references` 仍是最多 3 张 `data:image/png|jpeg|webp;base64,...`。
- 完成请求不带 `accountLabel` / `workerId` 时，服务端不改图片 metadata，和现在一样。

## 本机额外站点

`extraOrigins` 不写进网站下发的连接文件。它写在 Mac 本机的 `config.json`，用来允许连接文件里的 `origin` 落到内置两个站点之外。

每一项必须是精确的 `https://主机`。拒绝：

- `http://...`
- `https://*.grok.me` 以及任何带 `*` 的写法
- 带路径、查询、端口以外的多余部分、用户名密码
- 重复项

不配置或空数组时，允许的站点仍只有代码里的腾讯云站点和原 Vercel 站点。

## 多账号

一台 Mac 可以同时跑多个 Grok 账号。每个账号是一个进程：

- 自己的连接文件（自己的 `workerToken`）
- 自己的 Chrome profile
- 自己的锁、意图目录和日志
- 自己一次只领一个任务，任务之间保留约 15–25 秒空隙

本机配置：

```json
{
  "extraOrigins": ["https://sunny.example"],
  "accounts": [
    {"label": "甲", "connection": "/绝对路径/a.json", "profileDir": "/绝对路径/profile-a"},
    {"label": "乙", "connection": "/绝对路径/b.json", "profileDir": "/绝对路径/profile-b"}
  ]
}
```

`label` 是 1–32 位的文字、数字、下划线或连字符，不能是邮箱，不能含 `@`、`.`、`/`。标签会进存档目录和图片 metadata，不能拿来放 token。

没有 `accounts` 时，仍使用原来的 `connection` + `profileDir`，不分子目录。

存档：

- 无标签：`~/Pictures/剧爆棚出图/会员出图/`
- 有标签：`~/Pictures/剧爆棚出图/会员出图/<账号标签>/`

启动见 `tools/grok-member-worker/Start.command` 和 `install-launch-agent.sh`。一个账号暂停或退出不影响另一个。

## 接口

都在 `POST /api/image-worker?action=...`，参考图下载除外。请求带 `Authorization: Bearer <workerToken>`。不要带浏览器 `Origin`、`Cookie` 或 `Sec-Fetch-*`。不要跟随重定向。

| action | 方法 | 说明 |
| --- | --- | --- |
| `heartbeat` | POST `{}` | 标记在线 |
| `poll` | POST `{}` | 领一个任务，或 `{job: null}` |
| `complete` | POST | 回传结果，只此一次 |
| `reference` | GET | 下载一张参考图 |

`poll` 返回的 `lease` 是任务凭据，43 位，只在完成和下载参考图时使用。租约默认 10 分钟。过期后任务变成 `uncertain`，**不会自动再领**。

### 参考图怎么下发

建议用任务凭据保护的下载地址，不要把登录 cookie 嵌进任务，也不要让工作端去读浏览器 cookie。

v1 仍可在 `references` 里直接放 data URL。v2 也可以放：

```json
{"url": "https://与连接文件 origin 完全相同的主机/api/image-worker?action=reference&id=<任务 id>&part=0"}
```

工作端下载时：

```http
GET <url>
Authorization: Bearer <workerToken>
X-Jbp-Lease: <lease>
Accept: image/png, image/jpeg, image/webp
```

`part` 为 `0`、`1`、`2`，或改图时的 `source`。响应是图片字节，`Content-Type` 为 `image/png`、`image/jpeg` 或 `image/webp`。地址必须是 https，且主机与连接文件的 `origin` 一致。3xx 不跟随。401/403 视为连接失效并停止该进程。单张不超过 3MB。

本站对普通出图仍内联 data URL，以免旧工作端解析失败。改图任务的原图用上面的 `source` 地址下发，其余参考图仍是 data URL。另一个站点可以全部改用下载地址。

## 任务类型

### image

与 v1 相同。可以多一个 `"type": "image"`。`resolution` 为 `1k` 或 `2k`。`ratio` 为 `9:16`、`16:9`、`1:1`、`4:3`、`3:4`。`prompt` 1–8000 字。参考图最多 3 张。

工作端在 grok.com/imagine 上切换到「图片」，用页面上的文件控件上传参考图，再输入提示词并点一次提交。

### edit

```json
{
  "id": "<uuid>",
  "lease": "<43>",
  "type": "edit",
  "prompt": "保留未要求修改的部分。修改要求：……",
  "ratio": "1:1",
  "resolution": "1k",
  "source": {"url": "https://站点/api/image-worker?action=reference&id=<任务 id>&part=source"},
  "references": []
}
```

`source` 是要改的那张图，可以是 data URL 或下载对象。`references` 是额外参考，二者合计最多 3 张。没有 `source` 时，第一张 `references` 就是要改的图。工作端只通过页面上传，步骤名是「改图」。

本站在任务带 `metadata.parentImageId` 时记为 `edit`。

### video

只定义协议，工作端不生成视频。

```json
{
  "id": "<uuid>",
  "lease": "<43>",
  "type": "video",
  "prompt": "……",
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 6,
  "audio": false,
  "references": []
}
```

- `resolution`：`480p`、`720p`、`1080p`
- `duration`：1–60 的整数秒
- `audio`：布尔，声音开关
- `references`：同上，最多 3 张

工作端不打开页面，直接回传：

```json
{"id": "…", "lease": "…", "error": "REJECTED", "reason": "UNSUPPORTED"}
```

面向用户的句子是「暂不支持视频任务，未开始生成」。额度按明确失败释放。

## 结果怎么回传

`POST /api/image-worker?action=complete`

成功：

```json
{"id": "…", "lease": "…", "dataUrl": "data:image/png;base64,…", "accountLabel": "甲", "workerId": "primary"}
```

失败：

```json
{"id": "…", "lease": "…", "error": "REJECTED", "reason": "STRUCTURE", "step": "上传参考图", "accountLabel": "甲", "workerId": "primary"}
```

`error` 只能是 `REJECTED`（明确失败，释放额度）或 `UNCERTAIN`（结果不明，额度继续预占，**永不自动重排**）。不能和服务端自由文本混用。`reason` 只能是下表里的代码。`step` 只有 `STRUCTURE` 能带。

`accountLabel` 和 `workerId` 都可以不传。传入时：

- `accountLabel` 规则与本机标签相同，拒绝邮箱
- `workerId` 必须等于该连接在服务端的 id（本站是 `primary`），对不上就 400，任务保持租约
- 服务端把它们写进**图片** metadata，并合并进任务 metadata，供工作台显示「出图账号 / 工作端」
- 不写入 token、lease、邮箱或 cookie

成功响应：`{"saved": true, "status": "done"|"failed"|"uncertain"}`。同一结果可以重放；换一个结果是 409。

## 失败码

工作台显示的是中文句子，不是英文代码。自由文本会被丢掉。

| reason | 结果 | 工作台句子 | 工作端接着做什么 |
| --- | --- | --- | --- |
| `LOGIN` | REJECTED | Mac 上的 Grok 会员账号未登录或登录已过期，请在 Mac 上重新登录 grok.com 后再出图 | 暂停该账号，不领下一张 |
| `CAPTCHA` | REJECTED | grok.com 要求人机验证，请在 Mac 上手动完成验证后再出图 | 暂停该账号。不绕过验证码 |
| `QUOTA` | REJECTED | Grok 会员生图额度已用完，请等额度恢复后再出图 | 暂停该账号 |
| `CONTENT` | REJECTED | 提示词或图片被 Grok 拒绝生成，请修改提示词后重试 | 这一张不再提交。其他任务可以继续 |
| `BUSY` | REJECTED | Mac 上该 Grok 浏览器窗口正被占用，请关闭后再出图 | 暂停该账号 |
| `SUBMIT` | REJECTED 或 UNCERTAIN | Grok 页面提交失败，请重试 | 点过提交但没有响应时是 UNCERTAIN，不再点第二次 |
| `TIMEOUT` | UNCERTAIN | Grok 页面超时未出图，未重复提交；请稍后重试 | 不自动重排 |
| `PAGE` | REJECTED 或 UNCERTAIN | Grok 页面异常，未能完成出图，请重试；多次失败请联系管理员 | 不自动重跑这一张 |
| `ACCOUNT` | REJECTED | Mac 上登录的 Grok 账号与配置不一致，已停止出图 | 停止 |
| `REF_LIMIT` | REJECTED | 参考图数量超过网页当前允许的张数，本次未提交，请减少后重试 | 不上传超限的部分，不重试 |
| `UNSUPPORTED` | REJECTED | 暂不支持视频任务，未开始生成 | 不打开页面 |
| `STRUCTURE` | 见下 | `网页结构变化：<步骤>` | 停下，不盲目重试 |

`STRUCTURE` 的 `step` 只能是：`打开页面`、`切图片`、`选宽高比`、`找输入框`、`输入`、`上传参考图`、`改图`、`提交`、`等图`、`下载`。

页面元素找不到、上传控件变了、结果识别不到：回传 `STRUCTURE`，句子为「网页结构变化：」加上这一步。提交前就失败的是 `REJECTED`。已经点过提交、但结果对不上的是 `UNCERTAIN`。两种都不自动重排，也不换一种点法再试。

验证码、登录过期、额度用完：任务失败并在工作台写出上表的句子，该账号停住，等用户处理。不要硬刷。

## 工作端行为

- 只操作用户自己已经登录的 grok.com 页面：点击、输入、选择文件。
- 不导出 cookie 或 token，不调用未公开接口，不绕人机验证。
- 每个账号同时只有一个任务。
- 参考图张数以网页当时允许的为准（文件控件的 `multiple`、`data-max`，或页面上的「最多 N 张」）。超过则 `REF_LIMIT`，不截断着上传。
- 上传控件找不到，或 `setInputFiles` 失败：`网页结构变化：上传参考图` 或 `网页结构变化：改图`，只查一次控件，最多再点一次「上传」类按钮把控件露出来，然后停下。
- 付费 xAI 图片接口保持关闭。不要设置 `JBP_IMAGE_EXECUTION=direct`，也不要为了出图去设 `JBP_ALLOW_XAI_API`。
- 日志不打印 `workerToken`、lease 或 cookie。

## 给另一个站点的实现提示

队列可以继续用一个 worker 凭据，也可以为每个 Mac 账号签发一份连接文件（各自的 token）。并行出图时，每个凭据同时只租一个任务，账号之间不要互相取消。

参考图放在任务租约后面，用上面的 GET 下发。完成时接受可选的 `accountLabel` 和 `workerId`，把它们放进图片 metadata。`uncertain` 的任务不要再 `poll` 出去。
