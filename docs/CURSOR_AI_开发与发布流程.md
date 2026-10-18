# 剧爆棚工作台：Cursor 中文开发与安全发布指南

## 已有项目
- GitHub 源码：https://github.com/hiphopyx-dotcom/huabugongju
- 当前线上：https://jubaopeng-canvas.vercel.app/
- 现有生产分支：main
- Vercel 项目：jubaopeng-canvas

本指南只配置代码开发工作流，**不代表已经接通 Cursor 账号、云代理、模型 API 或自动部署**。这些外部账号授权需由拥有者在相应平台完成。

## 一、打开项目（二选一）
### A. Mac 本地 Cursor
1. 安装并登录 https://cursor.com 。
2. 登录与此代码仓库对应的 GitHub 账户。
3. 在 Cursor 中 Clone Repository，填入 https://github.com/hiphopyx-dotcom/huabugongju.git 。
4. 打开克隆后的文件夹，让 Agent 读取 AGENTS.md 和 .cursor/rules/。
5. 之后在 Cursor 聊天中用中文提出功能请求；要求 Agent 在独立分支修改和创建 PR。

### B. Cursor 云端 Agent（可通过手机发起）
1. 打开 https://cursor.com/dashboard/integrations ，连接 GitHub，授权该仓库。
2. 打开 https://cursor.com/agents ，选择本仓库，为 Cloud Agent 配置受控开发环境。
3. 只将需要的测试/开发密钥放到 Cursor 的 Secrets 环境，不把生产密钥复制到聊天、代码和工单。
4. 给 Agent 中文指令：先检查代码、单独分支开发、完成回归测试并提交 PR，不要自动发布。

## 二、首个可复制的中文开发指令
请以 hiphopyx-dotcom/huabugongju 的现有代码为基础维护剧爆棚工作台。先读取 AGENTS.md 和 .cursor/rules，分析具体模块与影响范围。对我描述的需求，仅在新功能分支最小修改代码，保留原有全部模块、人物一致性设置、项目数据、用户权限和精简/正式版。修改后运行已有回归测试与 TypeScript 检查，在 PR 中报告结果及人工验收办法。如无法验证请明确说明。未经我确认绝不合并 main，也不要操作生产数据或生产环境。

## 三、改动到上线的步骤
1. 用中文下达一个明确功能需求。
2. Cursor AI 在功能分支修改代码，并运行测试。
3. GitHub Pull Request 自动执行本仓库的 AI Change Checks 工作流。
4. 若 Vercel 项目已正确关联当前 GitHub 仓库，并启用 Preview，PR 可产生预览部署；若没有，需先在 Vercel 项目 Settings → Git 中核实连接。**不要为此新建同名生产项目或自动替换线上站点。**
5. 在预览中人工检验用户登录、管理员权限、剧本编辑、分镜、素材、协作及浏览器行为。涉及收费和模型调用时使用测试账号/测试额度。
6. 检查通过并由拥有者明确批准后，合并到 main，并观察正式部署结果与运行日志。
7. 如果出现故障，优先回滚到上一个确认健康的 Vercel 部署，随后分析和修复。

## 四、必须手动开启的 GitHub 保护
当前 main 若没有分支保护，请在 GitHub 仓库 Settings → Rules → Rulesets 配置：以 main 为目标，禁止直接推送，要求 PR 合并，要求 AI Change Checks 状态检查成功，要求必要的人工审核。确认规则生效后再依赖它阻止错误上线。

## 五、自动评审剧本的后续开发
剧本写作 → Gemini 独立评分 → OpenAI 按意见修订 → Gemini 复评 → 人工采纳，属于业务功能的第二阶段，不应混入网站代码审查。
要求独立版本号、模型请求日志、95分默认阈值、人工终审、失败重试和成本上限；不允许循环无上限调用，也不允许覆盖锁定剧本。

## 六、费用和权限说明
Cursor 订阅、OpenAI/Gemini/Grok API、Vercel、GitHub 的计费各自独立。Cursor 连接 GitHub 必须由用户自行授权；GitHub 登录凭证、模型 API Key 与生产数据库密码都不可粘贴到 AI 对话中。
