// 独立视频页：缩略图和提交读同一条像素。不写图库，不跨账号复制。
// 数量来自现有契约：画布节点 clipImagesForRequest 对非首尾帧只发 1 张；
// pianchang-video 的 reference_images 在路由里截到 14。11 张能读不等于 11 张会发。

const IMAGE = /^(data:image\/|https?:\/\/|blob:)/i;
const VIDEO = /^(data:video\/|https?:\/\/|blob:)/i;

export const VIDEO_PAGE_SEND_LIMITS = {
  文生视频: { images: 0, frames: 0, videos: 0 },
  图生视频: { images: 1, frames: 0, videos: 0 },
  全能参考: { images: 1, frames: 0, videos: 0 },
  首尾帧: { images: 0, frames: 2, videos: 0 },
  多参考图: { images: 14, frames: 0, videos: 0 },
  参考视频: { images: 0, frames: 0, videos: 1 },
};

export function resolveVideoPageMedia(asset, galleryGet) {
  const src = typeof asset?.src === "string" ? asset.src.trim() : "";
  if (asset?.kind === "video") return VIDEO.test(src) ? src : "";
  if (IMAGE.test(src)) return src;
  const key = typeof asset?.imageLibraryId === "string" ? asset.imageLibraryId : "";
  if (!key || typeof galleryGet !== "function") return "";
  let local = "";
  try {
    local = galleryGet(key);
  } catch {
    return "";
  }
  return typeof local === "string" && IMAGE.test(local.trim()) ? local.trim() : "";
}

export function videoThumbSrc(asset, galleryGet) {
  return resolveVideoPageMedia(asset, galleryGet);
}

function unique(ids) {
  const out = [];
  for (const id of ids || []) {
    if (typeof id !== "string" || !id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function imageOf(assets, id, galleryGet) {
  const asset = (assets || []).find((item) => item && item.id === id);
  const name = asset?.name || id || "";
  if (!asset || asset.kind === "video") return { id, name, src: "" };
  return { id, name, src: resolveVideoPageMedia(asset, galleryGet) };
}

function stopped(error) {
  return { ok: false, send: false, error, image: "", lastFrame: "", referenceImages: [], video: "", used: [] };
}

function ready(fields) {
  return { ok: true, send: true, error: "", ...fields };
}

export function planVideoPageSubmit({ method, checkedIds, assets, firstId, lastId, videoId, galleryGet }) {
  const limits = VIDEO_PAGE_SEND_LIMITS[method];
  if (!limits) return stopped("这个视频方式暂不支持，没有提交");
  const checked = unique(checkedIds);
  if (limits.frames === 2) {
    const first = imageOf(assets, firstId, galleryGet);
    const last = imageOf(assets, lastId, galleryGet);
    if (!first.src || !last.src) return stopped("首尾帧需要两张能读出来的图，没有提交");
    const extra = checked.filter((id) => id !== firstId && id !== lastId);
    if (extra.length) return stopped(`首尾帧只发送首帧和尾帧 2 张。另外勾选了 ${extra.length} 张，没有提交`);
    return ready({ image: first.src, lastFrame: last.src, referenceImages: [], video: "", used: [first, last] });
  }
  if (limits.videos === 1) {
    if (checked.length || firstId || lastId) return stopped("参考视频只发送 1 条视频。请先取消图片选择，没有提交");
    const asset = (assets || []).find((item) => item && item.id === videoId);
    const src = asset ? resolveVideoPageMedia({ ...asset, kind: "video" }, galleryGet) : "";
    if (!src) return stopped("请先选择一条能读出来的参考视频，没有提交");
    return ready({ image: "", lastFrame: "", referenceImages: [], video: src, used: [{ id: videoId, name: asset.name || videoId, src }] });
  }
  if (limits.images === 0) {
    if (checked.length || firstId || lastId || videoId) return stopped("文生视频不发送参考图或参考视频。请先取消选择，没有提交");
    return ready({ image: "", lastFrame: "", referenceImages: [], video: "", used: [] });
  }
  if (limits.images === 1) {
    const ids = unique([...(firstId ? [firstId] : []), ...checked]);
    if (ids.length !== 1) return stopped(`${method}只发送 1 张。当前选择了 ${ids.length} 张，没有提交`);
    const image = imageOf(assets, ids[0], galleryGet);
    if (!image.src) return stopped(`参考图「${image.name}」没有读出像素，没有提交`);
    return ready({ image: image.src, lastFrame: "", referenceImages: [], video: "", used: [image] });
  }
  if (checked.length < 1 || checked.length > limits.images) {
    return stopped(`多参考图最多发送 ${limits.images} 张。当前勾选 ${checked.length} 张，没有提交`);
  }
  const used = checked.map((id) => imageOf(assets, id, galleryGet));
  const missing = used.find((item) => !item.src);
  if (missing) return stopped(`参考图「${missing.name}」没有读出像素，没有提交`);
  return ready({ image: "", lastFrame: "", referenceImages: used.map((item) => item.src), video: "", used });
}

export function providerAllowsEnqueue(choice) {
  const id = typeof choice?.video?.id === "string" ? choice.video.id : "";
  if (id === "grok") return { ok: true, send: true, provider: "grok", error: "" };
  return {
    ok: false,
    send: false,
    provider: id,
    error: id ? "这个出图方式暂不可用" : "出视频方式未知，没有提交",
  };
}

function memberHeaders(headers) {
  const next = { ...(headers || {}) };
  delete next["content-type"];
  delete next["Content-Type"];
  return next;
}

export function videoChoiceRequest(headers) {
  return { url: "/api/images?action=choice", method: "GET", headers: memberHeaders(headers) };
}

export function videoSubmitRequest(body, headers) {
  return {
    url: "/api/pianchang-video",
    method: "POST",
    headers: { "Content-Type": "application/json", ...memberHeaders(headers) },
    body,
  };
}

export function videoPollRequest(jobId, headers) {
  return {
    url: "/api/images?action=job&id=" + encodeURIComponent(jobId) + "&kind=video",
    method: "GET",
    headers: memberHeaders(headers),
  };
}

export function videoPageExchange({ plan, choice, headers, prompt, aspect, duration, resolution, audio }) {
  if (!plan?.send) return { send: false, error: plan?.error || "没有提交出视频", requests: [] };
  const gate = providerAllowsEnqueue(choice);
  if (!gate.send) return { send: false, error: gate.error, requests: [] };
  const body = {
    prompt,
    aspect,
    duration,
    resolution,
    audio: audio !== false,
    image: plan.image || "",
    lastFrame: plan.lastFrame || "",
    video: plan.video || "",
  };
  if (plan.lastFrame) body.last_frame = plan.lastFrame;
  if (Array.isArray(plan.referenceImages) && plan.referenceImages.length) body.reference_images = plan.referenceImages.slice();
  return { send: true, error: "", requests: [videoSubmitRequest(body, headers)], body };
}

export function memberJobId(queued) {
  if (!queued || typeof queued !== "object") return "";
  const jobId = typeof queued.jobId === "string" ? queued.jobId.trim() : "";
  if (jobId) return jobId;
  return typeof queued.requestId === "string" ? queued.requestId.trim() : "";
}

export function acceptQueuedJob(queued, httpOk) {
  const jobId = memberJobId(queued);
  if (!httpOk || !queued?.ok || !jobId) return { ok: false, jobId: "", error: queued?.error || "没有提交出视频" };
  return { ok: true, jobId, error: "" };
}

export function pollRequestFor(accepted, headers) {
  if (!accepted?.ok || !accepted.jobId) return [];
  return [videoPollRequest(accepted.jobId, headers)];
}

export function pagePollDecision(job) {
  if (!job || job.ok === false) return { terminal: true, ok: false, pending: false, artifact: "", error: job?.error || "视频查询失败" };
  if (job.status === "failed" || job.status === "error") {
    return { terminal: true, ok: false, pending: false, artifact: "", error: job.error || "出视频失败" };
  }
  const dataUrl = typeof job.dataUrl === "string" && job.dataUrl ? job.dataUrl : "";
  const url = typeof job.url === "string" && /^(https?:\/\/|data:video\/)/i.test(job.url) ? job.url : "";
  const artifact = dataUrl || url;
  if (job.status === "done" && artifact) return { terminal: true, ok: true, pending: false, artifact, error: "" };
  if (job.status === "done") return { terminal: true, ok: false, pending: false, artifact: "", error: "没有产物" };
  return { terminal: false, ok: false, pending: true, artifact: "", error: "" };
}
