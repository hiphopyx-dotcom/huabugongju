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

function compose(box) {
  const read = key => box.querySelector(`[data-board="${key}"]`)?.value || "";
  const selected = {};
  for (const [key, , , fallback] of SB.groups) {
    if (key === "technique") continue;
    selected[key] = read(key) || fallback || "";
  }
  const language = SB.videoLanguage({ settings: { videoLanguage: selected, videoFocalLength: "", videoAperture: "", storyStyle: "" } }).prompt;
  const action = read("action").trim();
  const dialogue = read("dialogue").trim();
  const body = [action && `画面：${action}`, dialogue && `对白：${dialogue}`].filter(Boolean).join("\n");
  return body ? [body, language].filter(Boolean).join("\n") : language;
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
  const fields = SB.groups.filter(([key]) => key !== "technique").map(([key, label, list, fallback]) => `<label class="field">${esc(label)}<select data-board="${esc(key)}" aria-label="视频${esc(label)}">${list.map(option => `<option value="${esc(option.id)}" ${option.id === (fallback || "") ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`).join("");
  return `<p class="muted">按连续分镜的镜头选项出视频。景别、机位、构图、运镜和光影会写进出片，不用再只填一段提示词。</p><div class="field"><label>从连续分镜带入</label><select data-board="shot" aria-label="从连续分镜带入"><option value="">不指定，用下面的镜头选项</option></select></div><div class="shot-param-grid">${fields}</div><label class="field">画面<textarea data-board="action" aria-label="画面" placeholder="这一镜在做什么"></textarea></label><label class="field">对白<textarea data-board="dialogue" aria-label="对白" placeholder="没有对白就留空"></textarea></label>`;
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
  const shotSelect = box.querySelector('[data-board="shot"]');
  const source = document.querySelector("#stageSourceShot");
  if (source) {
    for (const option of source.options) {
      if (!option.value) continue;
      const copy = option.cloneNode(true);
      shotSelect.appendChild(copy);
    }
  }
  const apply = () => writePrompt(compose(box));
  box.addEventListener("input", apply);
  box.addEventListener("change", async event => {
    if (event.target !== shotSelect) { apply(); return; }
    const id = shotSelect.value;
    if (!id) { apply(); return; }
    try {
      const projects = await loadProjects();
      let found = null;
      let project = null;
      for (const item of projects) {
        const shot = (item.shots || []).find(row => row.id === id);
        if (shot) { found = shot; project = item; break; }
      }
      if (found && project) {
        const pack = SB.shotData(project, found);
        const action = box.querySelector('[data-board="action"]');
        const dialogue = box.querySelector('[data-board="dialogue"]');
        const ots = String(pack.prompt || "").split("\n").find(line => line.startsWith("过肩"));
        if (action) action.value = [found.description || "", ots].filter(Boolean).join("\n");
        if (dialogue) dialogue.value = found.dialogue || "";
        for (const [key, , , fallback] of SB.groups) {
          const select = box.querySelector(`[data-board="${key}"]`);
          if (select) select.value = pack.params[key] || fallback || "";
        }
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
    apply();
  });
  apply();
}

const watch = new MutationObserver(() => {
  const main = document.querySelector("#main");
  if (main) mount(main).catch(() => {});
});
watch.observe(document.body, { childList: true, subtree: true });
mount(document).catch(() => {});
