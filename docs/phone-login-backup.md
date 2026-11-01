# 手机号登录与账户备份

从分镜站 / zinc-raven 根站接到工作台现有账户（`studio_accounts` + `studio_sessions`）。不新建平行用户表。没有 DROP、ALTER、UPDATE、DELETE。

## 接口

| 接口 | 行为 | 把握 |
|---|---|---|
| `POST /api/phone-login` | 用已开通账户的手机号和密码登录。成功时沿用工作台会话 cookie，并在 JSON 里返回同一个 token，供 `Authorization: Bearer` 使用。 | 高。依据 `fenjing-src/src/lib/members.server.ts` 的 `signInWithPhone`（手机号 + 密码，不是验证码）和 `src/routes/api/phone-login.ts`。 |
| `GET /api/whoami` | 先读 `Authorization: Bearer`，没有再读工作台 cookie。返回 `{ok, user:{id,name,phone,role}}`。 | 高（鉴权方式）。分镜站还返回 `email`（`手机号@phone.jubao.local`），工作台账户没有邮箱，这里不编造。把握：中。 |
| `GET /api/backup` | 只导出当前登录用户自己的工作台记录，下载 `jubaopeng-backup.json`。不含密码哈希、会话、租约。 | 中。分镜站 `snapshot.ts` 的 `createUserBackup` 导出的是 `jingben_*` 表和文件名 `jingben-backup.json`。工作台项目正文主要在浏览器里，服务端没有那 8 张表，所以只导出已有的账户侧数据。 |
| 短信验证码 | 请求体带 `action:"send"` 或 `code` 时走短信。五项环境变量缺任一则 `503`，错误文案是「短信服务未配置」，不抛异常。五项都有时返回「短信服务未接入」，仍然不外呼。 | 低。分镜站源码、`preview-backend-plan.md`、`preview-zinc-status.md` 都没有短信供应商或验证码接口。 |

分镜站登录成功页会把 token 写进 `grok-auth.bearer-token`。那是 Grok 根站自己的存储，这里不写。表单提交且浏览器要 HTML 时，只返回一句「已登录，请返回工作台」并设置工作台 cookie。

密码规则沿用工作台：成员密码 6–8 位也能登录。分镜站源码要求至少 8 位，这里不另做一套，避免已开通成员登不上。

## 环境变量

不写默认值，仓库和部署配置里也不填。

| 变量 | 用途 | 没配时 |
|---|---|---|
| `DATABASE_URL` | 工作台现有数据库。三个接口都要它。 | HTTP 503，`{"ok":false,"error":"未配置"}` |
| `JBP_SMS_PROVIDER` | 短信供应商标识 | 短信路径 503，「短信服务未配置」 |
| `JBP_SMS_ACCESS_KEY_ID` | 短信访问密钥 ID | 同上 |
| `JBP_SMS_ACCESS_KEY_SECRET` | 短信访问密钥 | 同上 |
| `JBP_SMS_SIGN_NAME` | 短信签名 | 同上 |
| `JBP_SMS_TEMPLATE_CODE` | 短信模板编号 | 同上 |

密码登录不读短信变量。五项都配上之后，本仓库仍没有可核对的短信网关，接口返回「短信服务未接入」，不会带着密钥去请求外部地址。
