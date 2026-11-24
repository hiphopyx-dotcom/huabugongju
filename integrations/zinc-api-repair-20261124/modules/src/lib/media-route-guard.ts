// 图片/视频路由的纯判定。不连数据库，不提交队列，不读取密钥。

export type JobViewer = { id?: string; phone?: string; staff?: boolean } | null;

export function emptyPromptDecision(body: unknown) {
  const record = body && typeof body === "object" ? (body as { prompt?: unknown }) : {};
  const prompt = String(record.prompt || "").trim();
  if (!prompt) return { status: 400, body: { ok: false, error: "没有画面要求", queued: false } };
  return null;
}

export function missingJobDecision(id: unknown) {
  if (!String(id || "").trim()) return { http: 400, body: { ok: false, error: "没有这条任务", queued: false } };
  return null;
}

export function withoutMemberProvider<T extends Record<string, unknown>>(record: T) {
  const next = { ...record };
  delete next.provider;
  return next;
}

export function stampMemberPayload(packed: { payload?: unknown } | null, viewer: JobViewer) {
  if (!viewer?.id) return packed;
  const payload = packed && typeof packed === "object" ? packed.payload : null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return packed;
  const row = payload as Record<string, unknown>;
  row.memberId = viewer.id;
  if (viewer.phone) row.memberPhone = viewer.phone;
  return packed;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function ownerStamp(row: Record<string, unknown>) {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  return {
    id: firstString(row.memberId, row.member_id, row.owner_id, metadata.memberId, payload.memberId),
    phone: firstString(row.memberPhone, row.phone, metadata.memberPhone, payload.memberPhone),
  };
}

export function jobAccessDecision(row: Record<string, unknown>, viewer: JobViewer) {
  const owner = ownerStamp(row);
  if (!owner.id && !owner.phone) return null;
  if (viewer?.staff) return null;
  if (!viewer?.id) return { http: 401, body: { ok: false, error: "请先登录", queued: false } };
  if (owner.id && owner.id !== viewer.id) return { http: 404, body: { ok: false, error: "没有这条任务", queued: false } };
  if (owner.phone && viewer.phone && owner.phone !== viewer.phone) return { http: 404, body: { ok: false, error: "没有这条任务", queued: false } };
  return null;
}

export function mapRouteError(error: unknown) {
  const status = Number((error as { status?: number })?.status) || 0;
  const name = error instanceof Error ? error.name : String((error as { name?: string })?.name || "");
  const message = error instanceof Error ? error.message : "";
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return { status, body: { ok: false, error: message || "请求无效", queued: false } };
  }
  if (name === "HTTPError") {
    const text = message && message !== "HTTPError" ? message.slice(0, 200) : "请求无效";
    return { status: 400, body: { ok: false, error: text, queued: false } };
  }
  return { status: 503, body: { ok: false, error: "出图队列还没有准备好，没有提交", queued: false } };
}

/** HTTP 200 或 queued:true 都不是完成。完成要有 dataUrl 或 http(s) url，失败是终态。 */
export function classifyPolledJob(body: { ok?: boolean; status?: string; error?: string; queued?: boolean; dataUrl?: string; url?: string } | null) {
  if (!body || body.ok === false) return { done: false, pending: false, terminal: false, reason: body?.error || "失败" };
  if (body.status === "failed" || body.status === "error") {
    return { done: false, pending: false, terminal: true, reason: body.error || "失败" };
  }
  const artifact = typeof body.dataUrl === "string" && body.dataUrl.trim()
    ? body.dataUrl.trim()
    : typeof body.url === "string" && /^https?:\/\//.test(body.url)
      ? body.url.trim()
      : "";
  if (body.status === "done" && artifact) return { done: true, pending: false, terminal: true, artifact };
  if (body.status === "done") return { done: false, pending: false, terminal: true, reason: "没有产物" };
  if (body.queued || body.status === "queued" || body.status === "running") {
    return { done: false, pending: true, terminal: false, reason: "" };
  }
  return { done: false, pending: false, terminal: false, reason: body.error || "没有产物" };
}
