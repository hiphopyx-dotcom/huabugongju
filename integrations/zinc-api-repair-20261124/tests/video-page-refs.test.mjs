import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedProvider } from "../modules/public/bench/provider-block.mjs";
import { autoSaveBlocked, noteSaveResponse } from "../modules/public/bench/cloud-conflict.mjs";
import { replaceOnce } from "../apply.mjs";
import { replacements } from "../edits.mjs";
import {
  VIDEO_PAGE_SEND_LIMITS,
  acceptQueuedJob,
  memberJobId,
  pagePollDecision,
  planVideoPageSubmit,
  pollRequestFor,
  providerAllowsEnqueue,
  videoPageExchange,
  videoThumbSrc,
} from "../modules/public/bench/video-page-refs.mjs";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const OTHER = "data:image/jpeg;base64,/9j/OTHER";
const headers = { "x-jbp-member": "member-8057", "x-jbp-phone": "13800008057" };

function asset(id, name, libraryId, src = "") {
  return { id, name, kind: "image", type: "角色", src, imageLibraryId: libraryId };
}

function gallery(map) {
  return (id) => map[id] || "";
}

test("空 src 加 imageLibraryId：命中时缩略图与提交相同", () => {
  const item = asset("node-1", "宋砚", "lib-song");
  const look = gallery({ "lib-song": JPEG });
  const thumb = videoThumbSrc(item, look);
  const plan = planVideoPageSubmit({
    method: "图生视频",
    checkedIds: ["node-1"],
    assets: [item],
    galleryGet: look,
  });
  assert.equal(thumb, JPEG);
  assert.equal(plan.send, true);
  assert.equal(plan.image, thumb);
  const exchange = videoPageExchange({
    plan,
    choice: { video: { id: "grok" } },
    headers,
    prompt: "夜巡",
    aspect: "16:9",
    duration: 5,
    resolution: "720P",
    audio: true,
  });
  assert.equal(exchange.requests.length, 1);
  assert.equal(exchange.requests[0].url, "/api/pianchang-video");
  assert.equal(exchange.requests[0].body.image, thumb);
  assert.equal(exchange.requests[0].headers["x-jbp-member"], "member-8057");
  assert.equal(exchange.requests[0].headers["x-jbp-phone"], "13800008057");
  assert.equal(exchange.requests[0].headers["Content-Type"], "application/json");
  assert.equal(JSON.stringify(exchange.requests).includes("api.x.ai"), false);
});

test("空 src 加 imageLibraryId：未命中时提交前失败且零请求", () => {
  const item = asset("node-1", "宋砚", "lib-missing");
  const look = gallery({});
  assert.equal(videoThumbSrc(item, look), "");
  const plan = planVideoPageSubmit({
    method: "图生视频",
    checkedIds: ["node-1"],
    assets: [item],
    galleryGet: look,
  });
  assert.equal(plan.send, false);
  assert.match(plan.error, /宋砚/);
  assert.match(plan.error, /没有读出像素/);
  assert.equal(plan.image, "");
  const exchange = videoPageExchange({ plan, choice: { video: { id: "grok" } }, headers, prompt: "夜巡" });
  assert.equal(exchange.send, false);
  assert.deepEqual(exchange.requests, []);
});

test("11 张可读不等于 11 张可发送", () => {
  assert.equal(VIDEO_PAGE_SEND_LIMITS["图生视频"].images, 1);
  assert.equal(VIDEO_PAGE_SEND_LIMITS["全能参考"].images, 1);
  assert.equal(VIDEO_PAGE_SEND_LIMITS["首尾帧"].frames, 2);
  assert.equal(VIDEO_PAGE_SEND_LIMITS["多参考图"].images, 14);
  assert.equal(VIDEO_PAGE_SEND_LIMITS["文生视频"].images, 0);
  const assets = Array.from({ length: 11 }, (_, index) => asset("a" + index, "图" + index, "lib-" + index));
  const look = gallery(Object.fromEntries(assets.map((item) => [item.imageLibraryId, JPEG + item.id])));
  const tooMany = planVideoPageSubmit({
    method: "图生视频",
    checkedIds: assets.map((item) => item.id),
    assets,
    galleryGet: look,
  });
  assert.equal(tooMany.send, false);
  assert.match(tooMany.error, /只发送 1 张/);
  assert.deepEqual(videoPageExchange({ plan: tooMany, choice: { video: { id: "grok" } }, headers }).requests, []);
  const one = planVideoPageSubmit({
    method: "图生视频",
    checkedIds: ["a3"],
    assets,
    galleryGet: look,
  });
  assert.equal(one.send, true);
  assert.equal(one.image, videoThumbSrc(assets[3], look));
  assert.equal(one.referenceImages.length, 0);
  const frames = planVideoPageSubmit({
    method: "首尾帧",
    checkedIds: [],
    assets,
    firstId: "a0",
    lastId: "a1",
    galleryGet: look,
  });
  assert.equal(frames.send, true);
  assert.equal(frames.image, videoThumbSrc(assets[0], look));
  assert.equal(frames.lastFrame, videoThumbSrc(assets[1], look));
  assert.notEqual(frames.image, frames.lastFrame);
  const extraFrame = planVideoPageSubmit({
    method: "首尾帧",
    checkedIds: assets.map((item) => item.id),
    assets,
    firstId: "a0",
    lastId: "a1",
    galleryGet: look,
  });
  assert.equal(extraFrame.send, false);
  assert.match(extraFrame.error, /2 张/);
  const multi = planVideoPageSubmit({
    method: "多参考图",
    checkedIds: assets.map((item) => item.id),
    assets,
    galleryGet: look,
  });
  assert.equal(multi.send, true);
  assert.equal(multi.referenceImages.length, 11);
  assert.deepEqual(multi.referenceImages, assets.map((item) => videoThumbSrc(item, look)));
  const over = planVideoPageSubmit({
    method: "多参考图",
    checkedIds: Array.from({ length: 15 }, (_, index) => "a" + index),
    assets: Array.from({ length: 15 }, (_, index) => asset("a" + index, "图" + index, "lib-" + index)),
    galleryGet: (id) => JPEG + id,
  });
  assert.equal(over.send, false);
  assert.match(over.error, /14/);
});

test("成员请求使用 jobId，轮询区分成功、失败和没有产物", () => {
  const queued = { ok: true, jobId: "job-1", requestId: "req-other" };
  assert.equal(memberJobId(queued), "job-1");
  const accepted = acceptQueuedJob(queued, true);
  assert.equal(accepted.ok, true);
  const polls = pollRequestFor(accepted, headers);
  assert.equal(polls.length, 1);
  assert.equal(polls[0].url, "/api/images?action=job&id=job-1&kind=video");
  assert.equal(polls[0].headers["x-jbp-member"], "member-8057");
  assert.equal(polls[0].url.includes("api.x.ai"), false);
  assert.equal(pagePollDecision({ ok: true, status: "done", dataUrl: "data:video/mp4;base64,AAAA" }).ok, true);
  assert.equal(pagePollDecision({ ok: true, status: "done", url: "https://cdn.example/clip.mp4" }).artifact, "https://cdn.example/clip.mp4");
  const failed = pagePollDecision({ ok: true, status: "failed", error: "出视频失败" });
  assert.equal(failed.terminal, true);
  assert.equal(failed.ok, false);
  const empty = pagePollDecision({ ok: true, status: "done" });
  assert.equal(empty.terminal, true);
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "没有产物");
  assert.equal(pagePollDecision({ ok: true, status: "queued" }).pending, true);
  const onlyRequest = acceptQueuedJob({ ok: true, requestId: "req-legacy" }, true);
  assert.equal(onlyRequest.jobId, "req-legacy");
  const missing = acceptQueuedJob({ ok: true }, true);
  assert.equal(missing.ok, false);
  assert.deepEqual(pollRequestFor(missing, headers), []);
});

test("未知或不支持的出视频方式零发送，且不改 choice", () => {
  const item = asset("node-1", "宋砚", "lib-song", OTHER);
  const plan = planVideoPageSubmit({
    method: "图生视频",
    checkedIds: ["node-1"],
    assets: [item],
    galleryGet: gallery({}),
  });
  assert.equal(plan.image, OTHER);
  for (const choice of [null, {}, { video: {} }, { video: { id: "muse" } }, { video: { id: "api.x.ai" } }]) {
    const exchange = videoPageExchange({ plan, choice, headers, prompt: "夜巡", aspect: "16:9", duration: 5 });
    assert.equal(exchange.send, false, JSON.stringify(choice));
    assert.deepEqual(exchange.requests, []);
  }
  assert.equal(providerAllowsEnqueue({ video: { id: "grok" } }).send, true);
  assert.equal(planVideoPageSubmit({ method: "没有这种", checkedIds: [], assets: [] }).send, false);
});

test("409 保护和 xAI 拦截仍然有效", () => {
  assert.equal(isBlockedProvider("https://api.x.ai/v1"), true);
  assert.equal(isBlockedProvider("https://api.x.ai.evil.com/v1"), true);
  assert.equal(isBlockedProvider("https://apihub.agnes-ai.com/v1"), false);
  const noted = noteSaveResponse({ cloudRevision: 4 }, { status: 409, ok: false, conflict: true, revision: 9 });
  assert.equal(noted.cloudRevision, 4);
  assert.equal(noted.vault, false);
  assert.equal(autoSaveBlocked({ cloudConflict: noted.cloudConflict }), true);
});

test("片段不是恰好一处时拒绝替换", () => {
  const duplicated = "alpha alpha";
  const refused = replaceOnce(duplicated, "alpha", "beta");
  assert.equal(refused.ok, false);
  assert.equal(refused.count, 2);
  assert.equal(refused.text, duplicated);
  const once = replaceOnce("alpha", "alpha", "beta");
  assert.equal(once.ok, true);
  assert.equal(once.text, "beta");
  assert.equal(replaceOnce("X", "X", "$$('.video-ref:checked')").text, "$$('.video-ref:checked')");
});

test("app.mjs 续接仍要求原前置哈希，并且新片段只登记一次", () => {
  const app = replacements.find((item) => item.dest === "public/bench/app.mjs");
  assert.equal(app.after, "3c7c7a5f54a790287d3468bf7a00e1a20a8f8a2b4d2f62ec55e8ec23551d01b3");
  assert.equal(app.before, "f6a1d2f8751eb717a9a3ba8a126010cae602df1da45e47df3708755361186145");
  assert.equal(app.resume[0].hash, "f2d64152e2bc0143375d9ecd8de5b6e1da38948d62f08ba5838783b73f4c332d");
  assert.equal(app.resume[0].from, 4);
  const added = app.steps.slice(4);
  assert.ok(added.length >= 4);
  const olds = added.map((step) => step.old);
  assert.equal(new Set(olds).size, olds.length);
  const handler = added.find((step) => step.old.includes("actions['video-generate']"));
  assert.equal(handler.new.includes("planVideoPageSubmit"), true);
  assert.equal(handler.new.includes("acceptQueuedJob"), true);
  assert.equal(handler.new.includes("$$('.video-ref:checked')"), true);
  assert.equal(handler.new.includes("if(!res.ok)"), true);
  assert.equal(handler.new.includes("!queued.requestId"), false);
  assert.equal(handler.new.includes("runVideoNode"), true);
});
