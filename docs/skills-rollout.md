# 技能库上线（zinc 预览库）

这份说明只针对预览后台 `jubaopeng-zinc` 和它自己的 Neon 库。正式站 `jubaopeng-canvas` 不执行这里的 SQL，也不要设置这里的开关。

技能库默认关闭。服务端只有环境变量 `JBP_SKILLS_ENABLED` 精确等于 `1` 时才接受导入、总览和使用记录。没设、空字符串或其他值都是关闭。关闭时接口不查技能表。预览页在接口返回未启用时，不显示技能库、技能下拉和技能总览。

程序启动不会建表。下面的语句要人工在 Neon 里执行。

## 执行前备份

1. 打开 Neon 控制台，进入 **jubaopeng-zinc 使用的那个项目**（不要选正式站那一个）。
2. 给当前数据库做一个分支，或者按控制台的快照 / Point-in-Time 保留一个可恢复点。
3. 确认分支或快照已经出现在控制台里，再执行 SQL。
4. 不要把数据库连接串、口令或控制台密钥写进仓库。

## 建表 SQL

文件：`deploy/migrations/20261101_skills.sql`

```sql
-- 预览站 zinc 独立库的技能表。只新建，不改已有的表和数据。
-- 由人在 Neon 控制台审核后手动执行。程序启动时不会跑这份文件。
CREATE TABLE IF NOT EXISTS studio_skills (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('fight','camera','dance','emotion','other')),
  stages text NOT NULL DEFAULT 'video',
  body text NOT NULL,
  notes text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  imported_by text NOT NULL,
  imported_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_skills_enabled_imported ON studio_skills (enabled, imported_at DESC);
CREATE TABLE IF NOT EXISTS studio_skill_uses (
  id text PRIMARY KEY,
  skill_id text NOT NULL,
  project_id text NOT NULL DEFAULT '',
  shot_id text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'video' CHECK (stage IN ('video','storyboard','image')),
  actor text NOT NULL,
  created bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_skill_uses_skill_created ON studio_skill_uses (skill_id, created DESC);
```

语句只有 `CREATE TABLE IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS`。没有 `DROP`、`ALTER`、`UPDATE`、`DELETE`、`INSERT`。可以重复执行。

## 打开开关

在 Vercel 项目 **jubaopeng-zinc** 的环境变量里设置：

`JBP_SKILLS_ENABLED=1`

只加在这个预览项目上。正式站项目不要加。改完后重新部署预览后台，让新变量生效。

预览页会请求 `GET /api/skills?action=status`。返回 `{"enabled":true}` 后，视频页才出现技能库；管理员入口才出现「技能总览」。

## 预览站怎么试

1. 在仓库根目录执行 `node scripts/export-bench.mjs`。默认后台是 `https://jubaopeng-zinc.vercel.app`。
2. 把 `bench-export/` 交给预览项目发布到 `https://zinc-raven-rocket-drift.grok.me/bench/`。
3. 用预览库里的管理员账号登录（Bearer，存在这个浏览器的 `sessionStorage`，键名 `jbp-bench-token`）。
4. 打开视频页，确认有「技能库」。逐镜编排打开后，每一镜有「技能」下拉，默认是「无」。
5. 管理员入口里打开「技能总览」，看名称、用途、启用、导入时间、适用阶段、使用次数。
6. 导入一份带 `SKILL.md` 的 zip 或文件夹。页面先给出文字预览，确认分类后再保存。分类由站点建议，默认只勾视频。
7. 选中「打戏」后看提示词是否按：参考权限、人物与武器锁定、场景与机位、分段时间轴、段尾交接、禁止项。禁止项不能删掉。超过 1500 字会截断并提示。

## 回滚

把 jubaopeng-zinc 上的 `JBP_SKILLS_ENABLED` 删掉或改成非 `1`，然后重新部署预览后台。页面和接口都会回到关闭。两张新表可以留着，关闭时不会被读取，也不影响原来的视频模板。

不要为了回滚去删表或改已有数据。
