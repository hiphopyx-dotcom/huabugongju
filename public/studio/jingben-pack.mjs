// 片场包：和分镜站导入认的 jingben_* 表同一套形状。不含密码、token、账户会话。

const tables = () => ({
  jingben_projects: [], jingben_episodes: [], jingben_characters: [], jingben_locations: [],
  jingben_props: [], jingben_beats: [], jingben_images: [],
});

function episodeId(projectId, name, index) {
  return `${projectId}-ep-${index+1}`;
}

export function exportJingbenPack(project, at = Date.now()) {
  const data = tables();
  const id = String(project?.id || 'project');
  data.jingben_projects.push({id, title: project?.title || '未命名', script_text: project?.script || ''});
  const names = [];
  const beats = project?.pianchang?.beats || [];
  for (const beat of beats) if (beat.episode && !names.includes(beat.episode)) names.push(beat.episode);
  if (!names.length) names.push('第一集');
  names.forEach((name, index) => data.jingben_episodes.push({id: episodeId(id, name, index), project_id: id, title: name, ep_no: index+1, script_text: ''}));
  const ep = name => episodeId(id, name, Math.max(0, names.indexOf(name)));
  for (const row of project?.pianchang?.characters || []) data.jingben_characters.push({id: row.id, project_id: id, episode_id: ep(row.episode), name: row.name, role: row.role || '', age: row.age || '', gender: row.gender || '', appearance: row.appearance || '', costume: row.costume || ''});
  for (const row of project?.pianchang?.locations || []) data.jingben_locations.push({id: row.id, project_id: id, episode_id: ep(row.episode), name: row.name, heading: row.heading || '', description: row.description || ''});
  for (const row of project?.pianchang?.props || []) data.jingben_props.push({id: row.id, project_id: id, episode_id: ep(row.episode), name: row.name, description: row.description || '', material: row.material || '', used_by: row.used_by || '', significance: row.significance || ''});
  beats.forEach((row, index) => data.jingben_beats.push({id: row.id, project_id: id, episode_id: ep(row.episode), seq: index+1, scene_heading: row.scene_heading || '', action: row.action || '', dialogue: row.dialogue || '', shot_size: row.shot_size || '', composition: row.composition || '', framing: row.framing || '', camera_move: row.camera_move || '', stylize: row.stylize || '', lighting: row.lighting || '', technique: row.technique || ''}));
  const images = project?.pianchang?.images || {};
  for (const [key, item] of Object.entries(images)) {
    const [entityId, kind] = key.split(':');
    data.jingben_images.push({id: item.id, project_id: id, entity_id: entityId, kind, image_url: project.pianchang.stills?.[key] || '', prompt: item.prompt || ''});
  }
  return {at, format: 'jingben-pack-v1', data};
}

export function charPackPath(name, label, ext = 'jpg') {
  const person = String(name || '人物').replace(/[\\/:*?"<>|]+/g, '_').trim() || '人物';
  return `${person}/${person}-${label || '图'}.${ext}`;
}
