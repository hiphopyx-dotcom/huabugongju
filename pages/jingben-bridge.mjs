const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const dataImage = value => typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value);

function episodeName(row, index) {
  const title = String(row?.title || "").trim();
  if (/^第.+\u96c6/.test(title)) return title.slice(0, 40);
  const n = Number(row?.ep_no);
  if (Number.isFinite(n) && n > 0) return `第${n}集`;
  return `第${index + 1}集`;
}

function kindType(kind) {
  if (kind === "hero" || kind === "detail") return "道具";
  if (kind === "frame" || kind === "reverse" || kind === "storyboard") return "分镜";
  if (["plan", "view_n", "view_e", "view_s", "view_w", "establishing", "wide", "interior"].includes(kind)) return "场景";
  return "角色";
}

function rows(pack, table) {
  const list = pack?.data?.[table];
  return Array.isArray(list) ? list : [];
}

export function projectsFromJingben(pack, uid = () => crypto.randomUUID()) {
  const projects = rows(pack, "jingben_projects");
  const source = projects.length ? projects : [{ id: uid(), title: "片场资产", script_text: "" }];
  return source.map(proj => {
    const projectId = safeId(proj.id) ? proj.id : uid();
    const episodes = rows(pack, "jingben_episodes").filter(row => !proj.id || row.project_id === proj.id);
    const names = new Map(episodes.map((row, index) => [row.id, episodeName(row, index)]));
    const nameOf = id => names.get(id) || "第一集";
    const episodeScript = episodes.map(row => {
      const name = nameOf(row.id);
      const body = String(row.script_text || "").trim();
      if (!body) return name;
      return body.startsWith(name) ? body : `${name}\n${body}`;
    }).join("\n\n");
    const master = String(proj.script_text || "").trim();
    const script = master.length >= episodeScript.length ? master : episodeScript;
    const belong = row => !proj.id || row.project_id === proj.id;
    const characters = rows(pack, "jingben_characters").filter(belong);
    const locations = rows(pack, "jingben_locations").filter(belong);
    const props = rows(pack, "jingben_props").filter(belong);
    const beats = rows(pack, "jingben_beats").filter(belong).sort((a, b) => Number(a.seq) - Number(b.seq));
    const images = rows(pack, "jingben_images").filter(belong);
    const used = new Set();
    const takeId = value => {
      let id = safeId(value) && !used.has(value) ? value : uid();
      used.add(id);
      return id;
    };
    const p = {
      version: 2,
      id: takeId(projectId),
      title: String(proj.title || "片场项目").slice(0, 80),
      created: Date.now(),
      updated: Date.now(),
      script,
      episodes: [...names.values()].map(name => ({ id: takeId(`ep-${name}`), name })),
      shots: [],
      assets: [],
      nodes: [],
      edges: [],
      clips: [],
      subtitles: [],
      tasks: [],
      settings: { ratio: "16:9", width: 1280, height: 720, fps: 24 },
      view: { x: 40, y: 40, zoom: 1 },
      pianchang: { v: 1, tab: "characters", aspect: "16:9", resolution: "1k", look: "cinematic", forceChar: false, scope: "all", episode: [...names.values()][0] || "第一集", characters: [], locations: [], props: [], beats: [], archivedShots: [], stills: {}, history: {}, grades: {}, images: {}, slotRefs: {}, slotGrades: {}, prompts: {}, pending: {}, fuse: {} },
    };
    const addEntity = (list, row, extra) => {
      const id = takeId(row.id);
      list.push({ id, name: String(row.name || "未命名").slice(0, 80), scope: row.scope === "series" ? "series" : "episode", episode: nameOf(row.episode_id), ...extra });
      return id;
    };
    const characterIds = new Map(characters.map(row => [row.id, addEntity(p.pianchang.characters, row, { role: row.role || "", age: row.age || "", gender: row.gender || "", appearance: row.appearance || "", costume: row.costume || "" })]));
    const locationIds = new Map(locations.map(row => [row.id, addEntity(p.pianchang.locations, row, { heading: row.heading || "", description: row.description || "", time_of_day: row.time_of_day || "", weather: row.weather || "", atmosphere: row.atmosphere || "" })]));
    const propIds = new Map(props.map(row => [row.id, addEntity(p.pianchang.props, row, { description: row.description || "", material: row.material || "", used_by: row.used_by || "", significance: row.significance || "" })]));
    const beatIds = new Map();
    for (const row of beats) {
      const id = takeId(row.id);
      beatIds.set(row.id, id);
      const shot = {
        id,
        episode: nameOf(row.episode_id),
        scene: String(row.scene_heading || "分镜").slice(0, 80),
        description: String(row.action || ""),
        dialogue: String(row.dialogue || ""),
        duration: Math.min(60, Math.max(0.5, Number(row.duration_sec) || 4)),
        nextGap: Number(row.next_gap_sec) || 0,
        startSec: Number(row.start_sec) || 0,
        size: row.shot_type || "中景",
        sourceText: String(row.script_excerpt || "").slice(0, 500),
      };
      p.shots.push(shot);
      p.pianchang.beats.push({ id, seq: p.shots.length, episode: shot.episode, scene_heading: shot.scene, action: shot.description, dialogue: shot.dialogue, shot_size: shot.size, duration_sec: shot.duration, next_gap_sec: shot.nextGap, start_sec: shot.startSec, script_excerpt: shot.sourceText });
    }
    let pictures = 0;
    const grouped = new Map();
    const loose = [];
    for (const row of images) {
      if (!dataImage(row.image_url)) continue;
      const kind = String(row.kind || "frame");
      const entityId = characterIds.get(row.entity_id) || locationIds.get(row.entity_id) || propIds.get(row.entity_id) || beatIds.get(row.entity_id) || "";
      const item = { row, kind, entityId, key: entityId ? `${entityId}:${kind}` : "" };
      if (!item.key) loose.push(item);
      else {
        const list = grouped.get(item.key) || [];
        list.push(item);
        grouped.set(item.key, list);
      }
    }
    const place = (row, kind, entityId) => {
      const id = takeId(row.id);
      const episode = nameOf(row.episode_id);
      p.assets.push({ id, name: `${kindType(kind)} ${kind}`.slice(0, 40), kind: "image", type: kindType(kind), src: row.image_url, created: Date.parse(row.created_at) || Date.now(), locked: false, tags: "", description: String(row.prompt || "").slice(0, 200), metadata: entityId ? { entityId, slot: kind, episode } : undefined });
      pictures += 1;
    };
    for (const item of loose) place(item.row, item.kind, "");
    for (const [key, list] of grouped) {
      list.sort((a, b) => String(a.row.created_at || "").localeCompare(String(b.row.created_at || "")));
      for (const item of list) place(item.row, item.kind, item.entityId);
      const current = list[list.length - 1];
      p.pianchang.stills[key] = current.row.image_url;
      const older = list.slice(0, -1).map(item => item.row.image_url).reverse();
      if (older.length) p.pianchang.history[key] = older;
    }
    p.bridge = { pictures, characters: characters.length, locations: locations.length, props: props.length, beats: beats.length };
    return p;
  });
}

export function jingbenPack(project) {
  const desk = project?.pianchang || {};
  const projectId = safeId(project?.id) ? project.id : "project";
  const episodeRows = Array.isArray(project?.episodes) && project.episodes.length ? project.episodes : [{ id: "ep-1", name: "第一集" }];
  const episodeId = name => episodeRows.find(row => row.name === name)?.id || episodeRows[0].id;
  const entity = (row, episode) => ({ ...row, project_id: projectId, episode_id: episodeId(episode || row.episode), user_id: "" });
  const images = [];
  for (const asset of project?.assets || []) {
    if (asset.kind !== "image" || !dataImage(asset.src)) continue;
    images.push({ id: asset.id, project_id: projectId, episode_id: episodeId(asset.metadata?.episode), user_id: "", entity_id: asset.metadata?.entityId || "", kind: asset.metadata?.slot || "frame", prompt: asset.description || "", image_url: asset.src, scope: "episode" });
  }
  return {
    at: Date.now(),
    source: "zinc-raven",
    data: {
      jingben_projects: [{ id: projectId, title: project?.title || "未命名", script_text: project?.script || "" }],
      jingben_episodes: episodeRows.map((row, index) => ({ id: row.id, project_id: projectId, ep_no: index + 1, title: row.name || `第${index + 1}集`, script_text: project?.script || "" })),
      jingben_characters: (desk.characters || []).filter(row => !row.archived).map(row => entity(row, row.episode)),
      jingben_locations: (desk.locations || []).filter(row => !row.archived).map(row => entity(row, row.episode)),
      jingben_props: (desk.props || []).filter(row => !row.archived).map(row => entity(row, row.episode)),
      jingben_beats: (desk.beats || []).map(row => entity({ ...row, shot_type: row.shot_size || row.shot_type || "中景" }, row.episode)),
      jingben_images: images,
      jingben_members: [],
    },
  };
}
