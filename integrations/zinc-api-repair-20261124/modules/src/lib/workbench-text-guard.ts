// 工作台文字的服务端守门。浏览器自定义模型由 custom-text-lane 直接请求。
// 这里不读取密钥，也不调用 api.x.ai。

export function mayCallPaidXai() {
  return false;
}

export function workbenchTextDecision(action: string, body: unknown, method: string) {
  if (action === "status") return { status: 200, body: { online: false, workers: [] as unknown[] } };
  if (action === "jobs") return { status: 200, body: { jobs: [] as unknown[] } };
  if (action === "job") return { status: 404, body: { error: "任务不存在" } };
  if (action !== "submit") return { status: 404, body: { error: "生成接口不存在" } };
  if (method !== "POST") return { status: 405, body: { error: "请使用 POST" } };
  const record = body && typeof body === "object" ? (body as { prompt?: unknown; channel?: unknown }) : {};
  const prompt = String(record.prompt || "").trim();
  if (!prompt) return { status: 400, body: { error: "请输入文字要求" } };
  if (record.channel !== undefined && record.channel !== "script") return { status: 400, body: { error: "生成通道无效" } };
  return { status: 409, body: { error: "未配置自定义模型" } };
}
