/* 工作台文字：消费本机已保存的 OpenAI 兼容配置。
 * 密钥只在请求头里使用，不进入返回值、任务记录或项目 JSON。
 * 未配置时失败。不调用 /api/generation，不回退 api.x.ai。
 */
import { activePublic, isBlockedProvider, normalizeBaseUrl, validateEntry } from "./custom-api-models.mjs";

const KEYS_KEY = "jbp-custom-openai-keys-v1";
const SYSTEM = "你是短剧分镜编剧。只返回 JSON，不要 markdown，不要解释。";
const TEXT_ACTIONS = new Set(["status", "jobs", "job", "submit"]);

export function isWorkbenchTextAction(action) {
  return TEXT_ACTIONS.has(action);
}

function stripSecret(text, secret) {
  let out = String(text ?? "");
  if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 180);
}

function readKey(storage, id) {
  try {
    const holder = storage || globalThis.localStorage;
    const raw = holder?.getItem?.(KEYS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const key = data && typeof data[id] === "string" ? data[id].trim() : "";
    return key;
  } catch {
    return "";
  }
}

function resolveActive(storage) {
  const active = activePublic(storage);
  if (!active || !active.hasKey) return { ok: false, error: "未配置自定义模型" };
  const problem = validateEntry({ name: active.name || "自定义模型", baseUrl: active.baseUrl, model: active.model });
  if (problem) {
    if (isBlockedProvider(active.baseUrl) || problem.includes("xAI")) return { ok: false, error: "付费 xAI 接口保持关闭" };
    return { ok: false, error: "未配置自定义模型" };
  }
  if (isBlockedProvider(active.baseUrl)) return { ok: false, error: "付费 xAI 接口保持关闭" };
  return {
    ok: true,
    id: active.id,
    name: active.name,
    model: active.model,
    baseUrl: normalizeBaseUrl(active.baseUrl),
  };
}

function bindSignal(parent, timeoutMs, timed) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timed.out = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) onAbort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function failureMessage(err, secret, timedOut) {
  if (timedOut) return "拆解超时，模型没有在时限内返回";
  const name = err && err.name;
  if (name === "AbortError") return "已取消";
  return stripSecret(err instanceof Error ? err.message : "文字生成失败", secret) || "文字生成失败";
}

export async function completeActiveChat({ storage, prompt, system = SYSTEM, fetchImpl, timeoutMs = 28000, signal } = {}) {
  const active = resolveActive(storage);
  if (!active.ok) {
    const status = active.error.includes("xAI") ? 403 : 409;
    throw Object.assign(new Error(active.error), { status });
  }
  const key = readKey(storage, active.id);
  if (!key) throw Object.assign(new Error("未配置自定义模型"), { status: 409 });
  let endpoint;
  try {
    const base = active.baseUrl.endsWith("/") ? active.baseUrl : active.baseUrl + "/";
    endpoint = new URL("chat/completions", base);
  } catch {
    throw Object.assign(new Error("未配置自定义模型"), { status: 409 });
  }
  if (endpoint.protocol !== "https:" || isBlockedProvider(endpoint.origin) || isBlockedProvider(active.baseUrl)) {
    throw Object.assign(new Error("付费 xAI 接口保持关闭"), { status: 403 });
  }
  const timed = { out: false };
  const { signal: merged, cancel } = bindSignal(signal, timeoutMs, timed);
  const call = fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await call(endpoint.href, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: active.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: String(system || SYSTEM).slice(0, 2000) },
          { role: "user", content: String(prompt || "").slice(0, 8000) },
        ],
      }),
      signal: merged,
    });
  } catch (err) {
    throw Object.assign(new Error(failureMessage(err, key, timed.out)), { status: timed.out ? 504 : 502 });
  } finally {
    cancel();
  }
  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = stripSecret(raw, key).replace(/\s+/g, " ").trim();
    const message = "模型接口返回 HTTP " + response.status + (detail ? " " + detail.slice(0, 120) : "");
    throw Object.assign(new Error(stripSecret(message, key)), { status: response.status });
  }
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("模型没有返回文字"), { status: 502 });
  }
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw Object.assign(new Error("模型没有返回文字"), { status: 502 });
  return text;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    result: job.result || "",
    error: job.error || "",
    requestId: job.requestId || "",
    prompt: job.prompt || "",
    adminLocked: false,
  };
}

export function createTextLane(options = {}) {
  const jobs = new Map();
  const storage = options.storage;
  const fetchImpl = options.fetchImpl;
  const timeoutMs = options.timeoutMs ?? 28000;
  const randomId = options.randomId || (() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "job-" + Date.now()));

  function remember(job) {
    jobs.set(job.id, job);
    while (jobs.size > 40) jobs.delete(jobs.keys().next().value);
  }

  async function status() {
    const active = resolveActive(storage);
    return {
      online: active.ok === true,
      workers: active.ok ? [{ id: "custom-browser", label: active.name || "自定义模型", active: true, online: true }] : [],
      configured: active.ok === true,
    };
  }

  async function one(id) {
    const job = jobs.get(String(id || ""));
    if (!job) throw Object.assign(new Error("任务不存在"), { status: 404 });
    return { job: publicJob(job) };
  }

  async function submit(body, signal) {
    const record = body && typeof body === "object" ? body : {};
    const prompt = String(record.prompt || "").trim();
    if (!prompt) throw Object.assign(new Error("请输入文字要求"), { status: 400 });
    if (record.channel !== undefined && record.channel !== "script") {
      throw Object.assign(new Error("生成通道无效"), { status: 400 });
    }
    const active = resolveActive(storage);
    if (!active.ok) throw Object.assign(new Error(active.error), { status: active.error.includes("xAI") ? 403 : 409 });
    const id = randomId();
    const job = {
      id,
      status: "running",
      result: "",
      error: "",
      requestId: String(record.requestId || ""),
      prompt: prompt.slice(0, 8000),
    };
    remember(job);
    try {
      const text = await completeActiveChat({
        storage,
        prompt,
        fetchImpl,
        timeoutMs,
        signal: signal || options.signal,
      });
      job.status = "done";
      job.result = text;
      job.error = "";
      return { result: text, job: publicJob(job) };
    } catch (err) {
      job.status = "failed";
      job.result = "";
      job.error = err instanceof Error ? err.message : "文字生成失败";
      throw Object.assign(new Error(job.error), { status: err?.status || 502, job: publicJob(job) });
    }
  }

  return async function dispatch(action, body, params = {}) {
    if (action === "status") return status();
    if (action === "jobs") return { jobs: [...jobs.values()].map(publicJob) };
    if (action === "job") return one(params.id || "");
    if (action === "submit") return submit(body, params.signal);
    throw Object.assign(new Error("生成接口不存在"), { status: 404 });
  };
}
