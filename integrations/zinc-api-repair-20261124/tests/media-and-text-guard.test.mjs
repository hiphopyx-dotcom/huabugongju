import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPolledJob,
  emptyPromptDecision,
  jobAccessDecision,
  mapRouteError,
  missingJobDecision,
  stampMemberPayload,
  withoutMemberProvider,
} from "../modules/src/lib/media-route-guard.ts";
import { vaultWriteDecision } from "../modules/src/lib/bench-vault-guard.ts";
import { mayCallPaidXai, workbenchTextDecision } from "../modules/src/lib/workbench-text-guard.ts";

test("空出图请求和缺少视频任务 id 是明确的 400", () => {
  const empty = emptyPromptDecision({});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, "没有画面要求");
  const missing = missingJobDecision("");
  assert.equal(missing.http, 400);
  assert.equal(missing.body.error, "没有这条任务");
  assert.equal(emptyPromptDecision({ prompt: "夜巡" }), null);
});

test("未处理的 HTTPError 不再保持 500", () => {
  const mapped = mapRouteError(Object.assign(new Error("HTTPError"), { name: "HTTPError", status: 500 }));
  assert.equal(mapped.status, 400);
  assert.equal(mapped.body.error, "请求无效");
  const denied = mapRouteError(Object.assign(new Error("请先登录"), { status: 401 }));
  assert.equal(denied.status, 401);
  const missing = mapRouteError(Object.assign(new Error("没有这条任务"), { status: 404 }));
  assert.equal(missing.status, 404);
});

test("图片和视频任务不能跨会员读取，失败和没有产物都不算完成", () => {
  const row = {
    memberId: "member-a",
    memberPhone: "13900008057",
    dataUrl: "data:image/png;base64,aaaa",
    payload: { memberId: "member-a" },
  };
  const before = row.dataUrl;
  const other = jobAccessDecision(row, { id: "member-b", phone: "13900000001" });
  assert.equal(other.http, 404);
  assert.equal(other.body.error, "没有这条任务");
  assert.equal(other.body.dataUrl, undefined);
  assert.equal(row.dataUrl, before);
  assert.equal(jobAccessDecision(row, { id: "member-a", phone: "13900008057" }), null);
  assert.equal(jobAccessDecision(row, null).http, 401);
  assert.equal(jobAccessDecision({ dataUrl: "data:image/png;base64,bbbb" }, { id: "member-b" }), null);
  assert.equal(jobAccessDecision(row, { id: "admin", staff: true }), null);

  assert.equal(classifyPolledJob({ ok: true, status: "done", dataUrl: "data:image/png;base64,aaaa" }).done, true);
  assert.equal(classifyPolledJob({ ok: true, status: "done", url: "https://cdn.example/a.png" }).done, true);
  assert.equal(classifyPolledJob({ ok: true, status: "done" }).done, false);
  assert.equal(classifyPolledJob({ ok: true, status: "done" }).reason, "没有产物");
  assert.equal(classifyPolledJob({ ok: true, status: "failed", error: "超时" }).terminal, true);
  assert.equal(classifyPolledJob({ ok: true, status: "failed", error: "超时" }).done, false);
  assert.equal(classifyPolledJob({ ok: true, status: "queued", queued: true }).pending, true);
  assert.equal(classifyPolledJob({ ok: true, status: "queued", queued: true }).done, false);
});

test("成员自带的 provider 会被丢掉，任务载荷写入归属且不带密钥", () => {
  const stripped = withoutMemberProvider({ prompt: "夜", provider: "muse" });
  assert.equal(Object.hasOwn(stripped, "provider"), false);
  const packed = { payload: { provider: "grok", data: { prompt: "夜" } } };
  stampMemberPayload(packed, { id: "member-a", phone: "13900008057" });
  assert.equal(packed.payload.memberId, "member-a");
  assert.equal(packed.payload.memberPhone, "13900008057");
  assert.equal(JSON.stringify(packed).includes("sk-"), false);
});

test("跨会员 vault 行拒绝覆盖，原文档保持不动", () => {
  const row = { id: "guihua", scope: "phone:13900000001", document: "桂花正文" };
  const blocked = vaultWriteDecision(row.scope, "phone:13900008057");
  assert.equal(blocked.status, 409);
  assert.equal(row.document, "桂花正文");
  assert.equal(row.scope, "phone:13900000001");
  assert.equal(vaultWriteDecision(row.scope, row.scope), null);
  assert.equal(vaultWriteDecision(undefined, "phone:13900008057"), null);
});

test("服务端文字路由不调用付费 xAI", () => {
  assert.equal(mayCallPaidXai(), false);
  assert.equal(workbenchTextDecision("submit", { prompt: "写一句" }, "POST").status, 409);
  assert.equal(workbenchTextDecision("submit", { prompt: "写一句" }, "POST").body.error, "未配置自定义模型");
  assert.equal(workbenchTextDecision("submit", {}, "POST").status, 400);
  assert.equal(workbenchTextDecision("submit", { prompt: "写", channel: "video" }, "POST").status, 400);
  assert.equal(workbenchTextDecision("status", null, "GET").body.online, false);
  assert.equal(workbenchTextDecision("job", null, "GET").status, 404);
});
