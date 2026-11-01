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
