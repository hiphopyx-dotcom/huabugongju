# 剧爆棚账户服务

Vercel 项目 Root Directory 为 deploy，启用 sourceFilesOutsideRootDirectory。构建时复制 ../pages 到 public；Node 24 Functions 提供 /api/accounts。

## 初始化

数据库执行 schema.sql 中的语句。服务端环境变量 DATABASE_URL 为 Neon 数据库连接，STUDIO_SETUP_TOKEN 为随机32字节初始化密钥；两者不写入仓库。首次初始化页面只允许持有初始化密钥的管理者设置姓名、手机号和密码。初始化后不能再次创建管理员。

## 权限

手机号为管理员分配的登录名，无公开注册，不发送短信验证码，不表示手机号已验证。密码使用独立随机盐的 scrypt 哈希。登录会话为 Secure/HttpOnly/SameSite=Strict Cookie，数据库只保存会话摘要。用户不能提升管理员角色，账户停用、改绑、重置密码后旧会话失效。

管理员可添加 Grok 账户标识，创建用户并分配对应标识，不保存 Grok 密码或 Cookie。只有通过后端管理员验证的 grok-open 入口会跳转到 Grok。分配记录不代表自动登录 Grok 或调用网页会员额度。

模型中心可配置剧本、白膜、图片、分镜页面，在框架限制允许时嵌入；被原站禁止嵌入时独立打开。输入包是本站定义的 JSON，旧模型需适配协议才能自动读取；当前不声称已经打通原模型的 API。

本地素材按登录账号分库存储。不能把 IndexedDB 隔离当作服务端保密边界；同一设备应使用独立系统账户。GitHub Pages 不托管账户服务，正式账户版使用 Vercel 同源站点。

## 双模型审稿室（开发版）

- 入口：`/script-review.html`，工作台首页顶部也提供“双模型审稿”链接。
- 在 Vercel 项目 `jubaopeng-canvas` 的 **Environment Variables** 中配置 `OPENAI_API_KEY` 和 `GEMINI_API_KEY`；可选 `OPENAI_MODEL`（默认 `gpt-5.1`）与 `GEMINI_MODEL`（默认 `gemini-3.1-pro`）。密钥只在后端读取，不存入仓库或浏览器。
- 由管理员手机号登录后启动，后端验证会话 Cookie、同源请求、封板名单及调用速率（每账户每小时最多30次）；普通成员暂不能调用付费模型。
- 工作流程按 **OpenAI 创作/修订 → Gemini 独立评审 → 根据评审复修 → Gemini 复评** 执行。95分为默认门槛，除评分外还检查严重问题与字数，最多3次修订。仅处理所选一集，不自动修改其他集。
- 审稿历史保存在**该浏览器内该账户的独立 IndexedDB**，每一次初稿、意见、修订、采纳均独立归档。生产环境暂没有服务器端审稿队列；关闭网页会中断后续步骤，已存阶段不会丢失。
- **人工采纳**才写回原项目。写回前对比原全文防止跨窗口覆盖；已封板集禁止生成/修改；请同步保留项目 JSON 和审稿 JSON 备份。
- Word 导出将当前项目已采纳的完整正文与填写的故事资料组合为 `.docx`；未存入项目或故事资料输入框的内容无法自动补齐。
- `deploy/tests/script-review.test.mjs` 使用模拟模型响应测试权限、锁定、字数及结构化审稿，不需要 API Key。首次启用需运行一次 `npm install` 以安装新增的 `docx` 依赖。
- 这套流程消耗独立的 OpenAI/Gemini API 配额，不复用 ChatGPT/Gemini 网页会员；本站不会将结果写回原生 ChatGPT 聊天窗口。
