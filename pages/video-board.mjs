import * as SB from "./storyboard.mjs?v=bd900549f538";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => {
    if (char === "&") return "&" + "amp;";
    if (char === "<") return "&" + "lt;";
    if (char === ">") return "&" + "gt;";
    if (char === '"') return "&" + "quot;";
    return "&" + "#39;";
  });
}

function projectKey() {
  return new URLSearchParams(location.search).get("project") || "current";
}

function readState() {
  try { return JSON.parse(localStorage.getItem("jbp-video-board:" + projectKey()) || "null"); }
  catch { return null; }
}

function writeState(box) {
  const state = {};
  for (const field of box.querySelectorAll("[data-board]")) state[field.dataset.board] = field.value;
  localStorage.setItem("jbp-video-board:" + projectKey(), JSON.stringify(state));
}

function optionName(box, key, id) {
  if (!id) return "未指定";
  const found = [...box.querySelectorAll(`[data-board="${key}"] option`)].find(option => option.value === id);
  return found?.textContent || "未指定";
}

function compose(box) {
  const read = key => box.querySelector(`[data-board="${key}"]`)?.value || "";
  const selected = {};
  for (const [key, , , fallback] of SB.groups) selected[key] = read(key) || (key === "technique" ? "" : fallback || "");
  const language = SB.videoLanguage({ settings: { videoLanguage: selected, videoFocalLength: "", videoAperture: "", storyStyle: "" } }).prompt;
  let ots = "";
  if (selected.angle === "过肩镜头") {
    const fromId = read("otsFrom");
    const toId = read("otsTo");
    const reverse = read("otsSide") === "reverse";
    const shoulder = reverse ? toId : fromId;
    const face = reverse ? fromId : toId;
    ots = shoulder || face
      ? `过肩${reverse ? "反打" : "正打"}：过 ${optionName(box, reverse ? "otsTo" : "otsFrom", shoulder)} 的肩，拍 ${optionName(box, reverse ? "otsFrom" : "otsTo", face)} 的脸。保持视线轴和空间关系，不越轴。`
      : "过肩：过肩双人镜头，保持视线轴，不越轴。";
  }
  const action = read("action").trim();
  const dialogue = read("dialogue").trim();
  const body = [action && `画面：${action}`, dialogue && `对白：${dialogue}`, ots].filter(Boolean).join("\n");
  return [body, language].filter(Boolean).join("\n");
}

function push(selector, value) {
  const field = document.querySelector(selector);
  if (!field || value == null || value === "") return;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function writePrompt(text) {
  push("#videoPrompt", text);
}

function controls() {
  const fields = SB.groups.map(([key, label, list, fallback]) => {
    const blank = key === "technique" ? `<option value="">不使用</option>` : "";
    const selected = key === "technique" ? "" : (fallback || "");
    return `<label class="field">${esc(label)}<select data-board="${esc(key)}" aria-label="视频${esc(label)}">${blank}${list.map(option => `<option value="${esc(option.id)}" ${option.id === selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
  }).join("");
  return `<div data-board-root><p class="muted">按连续分镜的镜头选项出视频。景别、机位、构图、运镜、光影、过肩和正反打会写进出片，不用再只填一段提示词。</p><div class="field"><label>从连续分镜带入</label><select data-board="shot" aria-label="从连续分镜带入"><option value="">不指定，用下面的镜头选项</option></select></div><div class="shot-param-grid">${fields}</div><div data-ots-slot></div><label class="field">画面<textarea data-board="action" aria-label="画面" placeholder="这一镜在做什么"></textarea></label><label class="field">对白<textarea data-board="dialogue" aria-label="对白" placeholder="没有对白就留空"></textarea></label></div>`;
}

function otsMarkup(people, from, to, side) {
  const choices = current => `<option value="">未指定</option>${people.map(person => `<option value="${esc(person.id)}" ${person.id === current ? "selected" : ""}>${esc(person.name)}</option>`).join("")}`;
  return `<div class="grid2 field"><label class="field">过谁的肩<select data-board="otsFrom" aria-label="过谁的肩">${choices(from)}</select></label><label class="field">拍谁的脸<select data-board="otsTo" aria-label="拍谁的脸">${choices(to)}</select></label></div><div class="field"><label>正反打</label><select data-board="otsSide" aria-label="正反打"><option value="front" ${side === "reverse" ? "" : "selected"}>正打</option><option value="reverse" ${side === "reverse" ? "selected" : ""}>反打（对调肩和脸）</option></select></div>`;
}

function syncOts(box, people) {
  const slot = box.querySelector("[data-ots-slot]");
  if (!slot) return;
  const angle = box.querySelector('[data-board="angle"]')?.value;
  if (angle !== "过肩镜头") { slot.innerHTML = ""; return; }
  if (slot.querySelector("[data-board='otsFrom']")) return;
  const saved = readState() || {};
  slot.innerHTML = otsMarkup(people, saved.otsFrom || "", saved.otsTo || "", saved.otsSide || "front");
}

async function loadProjects() {
  const names = [];
  if (indexedDB.databases) {
    for (const db of await indexedDB.databases()) if (db.name?.startsWith("jubaopeng-studio")) names.push(db.name);
  }
  if (!names.includes("jubaopeng-studio-v2")) names.push("jubaopeng-studio-v2");
  const projects = [];
  for (const name of names) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("projects")) { db.close(); continue; }
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    projects.push(...rows);
  }
  return projects;
}

function installFetch() {
  if (window.__jbpVideoBoardFetch) return;
  window.__jbpVideoBoardFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const box = document.querySelector("[data-board-root]");
      if (box && init && typeof init.body === "string" && url.includes("/api/pianchang-video")) {
        const data = JSON.parse(init.body);
        if (data && typeof data.prompt === "string") {
          const original = data.prompt;
          let extra = "";
          const stageAt = original.indexOf("景别、机位、焦距及运镜以白模片场");
          if (stageAt >= 0) extra += "\n" + original.slice(stageAt);
          const planAt = original.indexOf("按以下时间顺序在同一条视频中完成多个镜头");
          if (planAt >= 0) extra += "\n\n" + original.slice(planAt);
          data.prompt = [compose(box), extra.trim()].filter(Boolean).join("\n").slice(0, 4000);
          init = { ...init, body: JSON.stringify(data) };
        }
      }
    } catch {}
    return orig(input, init);
  };
}

function applySaved(box) {
  const saved = readState();
  if (!saved) return false;
  for (const [key, value] of Object.entries(saved)) {
    const field = box.querySelector(`[data-board="${key}"]`);
    if (field && value != null) field.value = value;
  }
  return true;
}

async function mount(root) {
  const prompt = root.querySelector("#videoPrompt");
  const field = prompt?.closest(".field");
  if (!prompt || !field || field.querySelector("[data-board]") || root.querySelector("[data-vlang]")) return;
  const box = document.createElement("div");
  box.innerHTML = controls();
  const label = field.querySelector("label");
  if (label) label.textContent = "镜头选项";
  prompt.hidden = true;
  field.appendChild(box);
  installFetch();
  const shotSelect = box.querySelector('[data-board="shot"]');
  const source = document.querySelector("#stageSourceShot");
  if (source) {
    for (const option of source.options) {
      if (!option.value) continue;
      shotSelect.appendChild(option.cloneNode(true));
    }
  }
  let people = [];
  const refresh = () => { syncOts(box, people); writePrompt(compose(box)); writeState(box); };
  applySaved(box);
  box.addEventListener("input", refresh);
  box.addEventListener("change", async event => {
    if (event.target !== shotSelect) { refresh(); return; }
    const id = shotSelect.value;
    if (!id) { refresh(); return; }
    try {
      const projects = await loadProjects();
      let found = null;
      let project = null;
      for (const item of projects) {
        const shot = (item.shots || []).find(row => row.id === id);
        if (shot) { found = shot; project = item; break; }
      }
      if (found && project) {
        people = (project.assets || []).filter(asset => asset.kind === "image" && asset.type === "角色").map(asset => ({ id: asset.id, name: asset.name }));
        const pack = SB.shotData(project, found);
        const action = box.querySelector('[data-board="action"]');
        const dialogue = box.querySelector('[data-board="dialogue"]');
        if (action) action.value = found.description || "";
        if (dialogue) dialogue.value = found.dialogue || "";
        for (const [key, , , fallback] of SB.groups) {
          const select = box.querySelector(`[data-board="${key}"]`);
          if (select) select.value = pack.params[key] || (key === "technique" ? "" : fallback || "");
        }
        syncOts(box, people);
        const from = box.querySelector('[data-board="otsFrom"]');
        const to = box.querySelector('[data-board="otsTo"]');
        const side = box.querySelector('[data-board="otsSide"]');
        if (from) from.value = found.otsFrom || "";
        if (to) to.value = found.otsTo || "";
        if (side) side.value = "front";
        const duration = Math.max(1, Math.min(15, Number(found.duration) || 5));
        push('[data-setting="videoDuration"]', String(duration));
        if (["16:9", "9:16", "1:1"].includes(found.ratio)) push('[data-setting="videoRatio"]', found.ratio);
        if (found.firstFrame) push('[data-setting="firstFrame"]', found.firstFrame);
        for (const assetId of pack.assetIds || []) {
          const check = document.querySelector(`.video-ref[value="${CSS.escape(assetId)}"]`);
          if (check) check.checked = true;
        }
        document.querySelector(".video-ref")?.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {}
    refresh();
  });
  try {
    const projects = await loadProjects();
    const id = new URLSearchParams(location.search).get("project");
    const project = projects.find(item => item.id === id) || projects[0];
    people = (project?.assets || []).filter(asset => asset.kind === "image" && asset.type === "角色").map(asset => ({ id: asset.id, name: asset.name }));
  } catch {}
  refresh();
}

const watch = new MutationObserver(() => {
  const main = document.querySelector("#main");
  if (main) mount(main).catch(() => {});
});
watch.observe(document.body, { childList: true, subtree: true });
mount(document).catch(() => {});
