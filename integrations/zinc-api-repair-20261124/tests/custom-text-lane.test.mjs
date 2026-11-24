import test from "node:test";
import assert from "node:assert/strict";
import { createTextLane } from "../modules/public/bench/custom-text-lane.mjs";
import { isBlockedProvider } from "../modules/public/bench/provider-block.mjs";
import { memoryStorage, upsertEntry } from "../modules/public/bench/custom-api-models.mjs";

const SECRET = "sk-test-secret-value";
const AGNES = "https://apihub.agnes-ai.com/v1";

function blockNetwork() {
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("blocked-network");
  };
  return () => {
    globalThis.fetch = previous;
  };
}

function agnesStorage() {
  const storage = memoryStorage();
  upsertEntry({
    name: "Agnes 国际版",
    baseUrl: AGNES,
    model: "agnes-3.0-flash",
    apiKey: SECRET,
  }, storage);
  return storage;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("已保存的 Agnes 配置返回正文，轮询读到同一正文，且结果不含密钥", async () => {
  const restore = blockNetwork();
  const calls = [];
  try {
    const dispatch = createTextLane({
      storage: agnesStorage(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ choices: [{ message: { content: "夜巡正文" } }] });
      },
    });
    const submitted = await dispatch("submit", { channel: "script", prompt: "写一句夜巡", requestId: "req-1" });
    assert.equal(submitted.result, "夜巡正文");
    assert.equal(submitted.job.status, "done");
    assert.equal(submitted.job.result, "夜巡正文");
    const polled = await dispatch("job", null, { id: submitted.job.id });
    assert.equal(polled.job.result, "夜巡正文");
    assert.equal(polled.job.status, "done");
    const listed = await dispatch("jobs");
    assert.equal(listed.jobs[0].result, "夜巡正文");
    const packed = JSON.stringify({ submitted, polled, listed });
    assert.equal(packed.includes(SECRET), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, AGNES + "/chat/completions");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.headers.Authorization, "Bearer " + SECRET);
    assert.equal(String(calls[0].url).includes("api.x.ai"), false);
  } finally {
    restore();
  }
});

test("没有自定义模型时文字提交失败，且不发出请求", async () => {
  const restore = blockNetwork();
  const calls = [];
  try {
    const dispatch = createTextLane({
      storage: memoryStorage(),
      fetchImpl: async () => {
        calls.push("called");
        return jsonResponse({ choices: [{ message: { content: "不应出现" } }] });
      },
    });
    const status = await dispatch("status");
    assert.equal(status.online, false);
    assert.deepEqual(status.workers, []);
    await assert.rejects(() => dispatch("submit", { prompt: "写一句" }), /未配置自定义模型/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("空正文先拒绝，不把未配置和付费接口混在一次请求里", async () => {
  const dispatch = createTextLane({ storage: memoryStorage(), fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(() => dispatch("submit", { prompt: "   " }), /请输入文字要求/);
});

test("恶意和别名 xAI 域名被拒绝，Agnes 主机可以保存", async () => {
  const blocked = [
    "https://api.x.ai/v1",
    "https://API.X.AI/v1/",
    "https://api.x.ai.",
    "https://foo.x.ai/v1",
    "https://api.x.com/v1",
    "https://api.x.ai.evil.com/v1",
    "https://x.ai",
    "https://user:pass@api.x.ai/v1",
    "https://api。x。ai/v1",
  ];
  for (const baseUrl of blocked) assert.equal(isBlockedProvider(baseUrl), true, baseUrl);
  assert.equal(isBlockedProvider(AGNES), false);
  assert.equal(isBlockedProvider("https://api.agnes-ai.cn/v1"), false);
  assert.equal(isBlockedProvider("https://example.com/v1"), false);
  assert.equal(isBlockedProvider("https://notx.ai/v1"), false);
  assert.equal(isBlockedProvider("https://xai.com/v1"), false);
  const storage = memoryStorage();
  storage.setItem("jbp-custom-openai-models-v1", JSON.stringify({
    version: 1,
    activeId: "bad",
    items: [{ id: "bad", name: "别名", baseUrl: "https://api.x.ai.evil.com/v1", model: "grok-4", created: 1, updated: 1 }],
  }));
  storage.setItem("jbp-custom-openai-keys-v1", JSON.stringify({ bad: SECRET }));
  const calls = [];
  const dispatch = createTextLane({
    storage,
    fetchImpl: async () => {
      calls.push("called");
      return jsonResponse({ choices: [{ message: { content: "不应出现" } }] });
    },
  });
  await assert.rejects(() => dispatch("submit", { prompt: "写一句" }), /付费 xAI 接口保持关闭/);
  assert.equal(calls.length, 0);
  const packed = JSON.stringify(await dispatch("status").catch((error) => error.message));
  assert.equal(packed.includes(SECRET), false);
});

test("中止、超时和 HTTP 错误都失败，响应里的密钥不会回到错误文本", async () => {
  const restore = blockNetwork();
  try {
    const httpLane = createTextLane({
      storage: agnesStorage(),
      fetchImpl: async () => new Response("bad " + SECRET, { status: 502 }),
    });
    const httpError = await httpLane("submit", { prompt: "写一句" }).then(() => null, (error) => error);
    assert.match(httpError.message, /HTTP 502/);
    assert.equal(httpError.message.includes(SECRET), false);
    assert.equal(httpError.job.status, "failed");
    const polled = await httpLane("job", null, { id: httpError.job.id });
    assert.equal(polled.job.status, "failed");
    assert.equal(polled.job.result, "");

    const controller = new AbortController();
    const abortLane = createTextLane({
      storage: agnesStorage(),
      signal: controller.signal,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    });
    const pendingAbort = abortLane("submit", { prompt: "写一句" });
    controller.abort();
    const aborted = await pendingAbort.then(() => null, (error) => error);
    assert.equal(aborted.message, "已取消");

    const timeoutLane = createTextLane({
      storage: agnesStorage(),
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
      }),
    });
    const timed = await timeoutLane("submit", { prompt: "写一句" }).then(() => null, (error) => error);
    assert.equal(timed.message, "拆解超时，模型没有在时限内返回");
  } finally {
    restore();
  }
});

test("未知任务是 404，空模型正文不算成功", async () => {
  const dispatch = createTextLane({
    storage: agnesStorage(),
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "  " } }] }),
  });
  await assert.rejects(() => dispatch("job", null, { id: "missing" }), /任务不存在/);
  await assert.rejects(() => dispatch("submit", { prompt: "写一句" }), /模型没有返回文字/);
});
