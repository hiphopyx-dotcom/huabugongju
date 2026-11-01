import {randomUUID} from 'node:crypto';
import {AccountError, hash, sessionToken, allowBearerOrigin, requireAdmin} from './security.mjs';
import {BUILTIN_FIGHT_ID} from '../../pages/fight-template.mjs';
import {categoryLabel, extractSkillPack, normalizeCategory, normalizeStages} from '../../pages/skill-import.mjs';

export function skillsEnabled(env = process.env) {
  return String(env?.JBP_SKILLS_ENABLED ?? '') === '1';
}

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
const LIMITS = {body: 3_500_000, name: 80, description: 500, bodyText: 200_000, notes: 500_000, uses: 30};
function text(value, max, label) {
  const out = String(value ?? '');
  if (out.length > max) throw new AccountError(400, label + '过长');
  return out;
}
function skillId(value) {
  const id = String(value ?? '');
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(id)) throw new AccountError(400, '技能标识无效');
  return id;
}
function on(value) { return value === true || value === 1 || value === '1'; }

async function readPack(body) {
  if (typeof body.zipBase64 === 'string') {
    if (body.zipBase64.length > LIMITS.body) throw new AccountError(413, '压缩包超过 2MB');
    let bytes;
    try { bytes = new Uint8Array(Buffer.from(body.zipBase64, 'base64')); }
    catch { throw new AccountError(400, '压缩包内容无效'); }
    return extractSkillPack({zipBytes: bytes});
  }
  if (!Array.isArray(body.files)) throw new AccountError(400, '请选择技能文件夹或 zip');
  return extractSkillPack({files: body.files.map(file => ({path: text(file?.path, 300, '文件名'), text: text(file?.text, LIMITS.notes, '技能正文')}))});
}

export function createSkillHandler(query, env = process.env) {
  return async function handle(req) {
    try {
      allowBearerOrigin(req);
      const action = new URL(req.url).searchParams.get('action') || 'status';
      if (!skillsEnabled(env)) {
        if (action === 'status' && req.method === 'GET') return json({enabled: false});
        return json({error: '技能库未启用'}, 404);
      }
      if (action === 'status' && req.method === 'GET') return json({enabled: true});
      const q = (sql, ...params) => query(sql, params);
      const one = async (sql, ...params) => (await q(sql, ...params))[0];
      const now = Date.now();
      const raw = sessionToken(req);
      const user = raw ? await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version', hash(raw), now) : null;
      if (!user) throw new AccountError(401, '请先登录');
      if (action === 'list' && req.method === 'GET') {
        const rows = await q("SELECT id,name,description,category,stages,body,enabled FROM studio_skills WHERE enabled=true ORDER BY imported_at DESC LIMIT 100");
        return json({skills: rows.map(publicSkill)});
      }
      if (action === 'use' && req.method === 'POST') {
        const body = await readJson(req);
        const uses = Array.isArray(body.uses) ? body.uses : [body];
        if (!uses.length || uses.length > LIMITS.uses) throw new AccountError(400, '使用记录无效');
        for (const item of uses) {
          const id = skillId(item.skillId);
          if (id !== BUILTIN_FIGHT_ID) {
            const skill = await one('SELECT id,enabled,stages FROM studio_skills WHERE id=$1', id);
            if (!skill || !on(skill.enabled)) throw new AccountError(404, '技能未启用');
          }
          const stage = normalizeStages([item.stage || 'video'])[0];
          await q('INSERT INTO studio_skill_uses (id,skill_id,project_id,shot_id,stage,actor,created) VALUES ($1,$2,$3,$4,$5,$6,$7)', randomUUID(), id, text(item.projectId, 128, '项目'), text(item.shotId, 128, '镜头'), stage, user.id, now);
        }
        return json({recorded: uses.length});
      }
      requireAdmin(user);
      if (action === 'overview' && req.method === 'GET') return json(await overview(q, one));
      if (action === 'preview' && req.method === 'POST') {
        const parsed = await readPack(await readJson(req));
        return json(previewOf(parsed));
      }
      if (action === 'import' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.confirm !== true) throw new AccountError(400, '请先预览并确认');
        const parsed = await readPack(body);
        const category = normalizeCategory(body.category || parsed.category);
        const stages = normalizeStages(body.stages || parsed.stages).join(',');
        const id = randomUUID();
        const notes = parsed.references.map(file => `## ${file.path}\n${file.text}`).join('\n\n').slice(0, LIMITS.notes);
        await q('INSERT INTO studio_skills (id,name,description,category,stages,body,notes,enabled,imported_by,imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)', id, text(parsed.name, LIMITS.name, '名称'), text(parsed.description, LIMITS.description, '用途'), category, stages, text(parsed.body, LIMITS.bodyText, '技能正文'), notes, user.id, now);
        return json({id, ...previewOf({...parsed, category, stages: stages.split(',')})}, 201);
      }
      if (action === 'update' && req.method === 'POST') {
        const body = await readJson(req);
        const id = skillId(body.id);
        if (typeof body.enabled !== 'boolean') throw new AccountError(400, '启用状态无效');
        const saved = await one('UPDATE studio_skills SET enabled=$1 WHERE id=$2 RETURNING id,enabled', body.enabled, id);
        if (!saved) throw new AccountError(404, '技能不存在');
        return json({id: saved.id, enabled: on(saved.enabled)});
      }
      if (action === 'delete' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.confirm !== true) throw new AccountError(400, '请先确认删除');
        const id = skillId(body.id);
        if (id === BUILTIN_FIGHT_ID) throw new AccountError(400, '内置打戏模板不能删除');
        const saved = await one('DELETE FROM studio_skills WHERE id=$1 RETURNING id', id);
        if (!saved) throw new AccountError(404, '技能不存在');
        return json({deleted: saved.id});
      }
      throw new AccountError(404, '技能接口不存在');
    } catch (error) {
      if (error instanceof AccountError || error.status) return json({error: error.message}, error.status || 400);
      if (error?.message && /超过|不安全|SKILL|Markdown|压缩包|分类|文件/.test(error.message)) return json({error: error.message}, 400);
      console.error('skill-service', error?.code || error?.name);
      return json({error: '技能表尚未建立或暂时不可用'}, 503);
    }
  };
}

async function readJson(req) {
  const raw = await req.text();
  if (raw.length > LIMITS.body) throw new AccountError(413, '请求过大');
  try { return JSON.parse(raw); }
  catch { throw new AccountError(400, '请求格式错误'); }
}
function publicSkill(row) {
  return {id: row.id, name: row.name, description: row.description, category: row.category, stages: String(row.stages || 'video').split(','), body: row.body, enabled: on(row.enabled)};
}
function previewOf(parsed) {
  return {name: parsed.name, description: parsed.description, category: parsed.category, categoryLabel: categoryLabel(parsed.category), stages: parsed.stages, body: parsed.body, dropped: parsed.dropped || [], warnings: parsed.warnings || []};
}
async function overview(q, one) {
  const rows = await q(`SELECT s.id,s.name,s.description,s.category,s.stages,s.enabled,s.imported_at,s.imported_by,a.name AS importer,
    (SELECT count(*) FROM studio_skill_uses u WHERE u.skill_id=s.id) AS uses,
    (SELECT max(created) FROM studio_skill_uses u WHERE u.skill_id=s.id) AS last_used
    FROM studio_skills s LEFT JOIN studio_accounts a ON a.id=s.imported_by ORDER BY s.imported_at DESC`);
  const builtin = await one('SELECT count(*) AS uses, max(created) AS last_used FROM studio_skill_uses WHERE skill_id=$1', BUILTIN_FIGHT_ID);
  return {
    skills: rows.map(row => ({id: row.id, name: row.name, description: row.description, category: row.category, stages: String(row.stages || 'video').split(','), enabled: on(row.enabled), importedAt: Number(row.imported_at), importedBy: row.importer || row.imported_by, uses: Number(row.uses) || 0, lastUsedAt: row.last_used == null ? null : Number(row.last_used)})),
    builtin: [{id: BUILTIN_FIGHT_ID, name: '打戏', description: '内置打戏模板。人物、武器和机位从镜头带入。', category: 'fight', stages: ['video'], enabled: true, builtin: true, uses: Number(builtin?.uses) || 0, lastUsedAt: builtin?.last_used == null ? null : Number(builtin.last_used)}],
  };
}
