# /api/bench-members 状态码（导出源码）

这次看到的 console 403 只有状态码，没有 method、action 和响应 JSON，并且发生在新建工程之前。下面的表说明导出路由各自会返回什么。不能用这张表把那条孤立 403 判成新建失败，也不能判成整段登录失效。

导出文件 `src/routes/api/bench-members.ts` 里，403 只来自项目归属：`GET action=project` 或 `POST action=project-save`，服务器已经认出成员，且 `member_projects.phone` 与该成员手机号不同。正文是「这不是你的项目」。修订冲突是 409。未登录是 401，或 200 且 `member:null` / `skipped:true`。管理员接口拒绝是 401「请用管理员登录」。

`CrossSiteRequestError`（403，消息 `Forbidden: cross-site request blocked`）写在 `authMiddleware` 和 app-data 连接器，不在 `bench-members.ts`。若以后拿到的 JSON 是这句，它不属于本路由的归属 403。

## 路由

| 方法 | action | 条件 | 状态 | 类别 |
|---|---|---|---|---|
| GET | admin-session | 任意 | 200 | 管理员探测。非管理员也是 200，`admin:false` |
| GET | vault | 没有云端身份 | 200 | `skipped:true`，本地工程还在 |
| GET | vault | 有手机号或管理员身份 | 200 | 按 scope 读取 |
| GET | projects | 没有云端身份 | 401 | 请先登录后再查看云端项目 |
| GET | project | 没有云端身份 | 401 | 同上 |
| GET | project | 有身份，id 不存在 | 404 | 云端没有这个项目 |
| GET | project | 有身份，手机号不同 | 403 | 这不是你的项目 |
| GET | projects | 有身份 | 200 | 只列出该手机号的项目 |
| GET | online / works / 空 | 非管理员且非二级管理员 | 401 | 请用管理员登录 |
| POST | vault-save | 没有云端身份 | 200 | `skipped:true` |
| POST | project-save / project-list | 没有云端身份 | 401 | 请先登录后再上传 |
| POST | project-save | 有身份，手机号不同 | 403 | 这不是你的项目。不写入 |
| POST | project-save | 有身份，修订号不同 | 409 | 云端有更新的版本，没有覆盖 |
| POST | work | 请求里的手机号对不上在册成员 | 401 | 请用开通时的手机号重新登录后再出图 |
| POST | pulse | 成员 id 不在服务器名单 | 401 | 心跳失败 |
| POST | session | cookie 无对应成员 | 200 | `member:null` |
| POST | login | 手机号或密码不对 | 200 | `ok:false`。页面再查本机成员表 |
| POST | logout | 任意 | 200 | 清 cookie |
| POST | save 成员名单 | 非管理员 | 401 | 请用管理员登录 |

## 前端谁会打到这些 action

当前三导演站是 `/bench/` 顶栏「成员登录」，不是根站 `/login`。`accounts.mjs` 在没有 `studio-api-base` 时走本机成员表。

| 调用点 | 请求 | 何时 |
|---|---|---|
| `accounts.mjs` `init` | POST `session` | 本机已有 `jbp-member-session` 时问 cookie |
| `accounts.mjs` 登录表单 | POST `login` | 顶栏成员登录 |
| `accounts.mjs` `startPresence` | POST `pulse` | 非管理员登录后每 12 秒 |
| `accounts.mjs` `storeDesk` / `syncDesk` | POST `save`、GET 成员名单 | 管理员或二级管理员保存名单 |
| `accounts.mjs` `paintOnline` / `memberWorks` | GET `online`、`works` | 开通成员面板 |
| `app.mjs` `pushVault` | POST `project-save`，成功后才 `vault-save` | 本地保存后 1.4 秒。冲突未解除时不再发送 |
| `app.mjs` `uploadLocalProject` | POST `project-save` | 用户点「上传到云端」 |
| `app.mjs` `loadCloudProjects` / `openCloudProject` | GET `projects` / `project` | 云端列表和打开 |
| `app.mjs` `adoptDurableProjects` | POST `project-list`，再 GET `project` | 登录 boot。补丁后不再把访客库抄进会员库 |
| `member-works.mjs` | POST `work` | 出图记录 |

## 本地可开、云端未认证

服务器 `login` 失败时返回 200 `ok:false`，不写 `jbp_member` cookie。页面若在本机 `jbp-bench-desk` 里对上手机号和密码，仍会把 `jbp-member-session` 写成那条本地 id，顶栏显示成员名。IndexedDB 按这个本地 id 打开工程。

之后的云请求带 `x-jbp-member`。该 id 不在 `bench_desk_members` 时，`memberFromRequest` 为空，`cloudOwner` 为空。`project-save` 是 401，`vault` 是 200 `skipped`，`session` 是 200 `member:null`。这些都不是 403。本地工程照常能开。

只有服务器认出了成员，并且项目 id 属于另一个手机号时，才是 403。那说明云端身份是有效的，拒绝的是这一条项目，不是会话过期。

要判断那条 console 403，需要补上：方法、query 或 JSON 里的 action、响应 JSON。在拿到这三项之前，保持「未归类」。
