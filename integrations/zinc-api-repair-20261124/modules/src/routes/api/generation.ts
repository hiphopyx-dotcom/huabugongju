import { createFileRoute } from "@tanstack/react-router";
import { workbenchTextDecision } from "@/lib/workbench-text-guard";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// 工作台文字不在这个路由调用付费 xAI。已保存的自定义模型由浏览器 custom-text-lane 直接请求。
async function handle(request: Request) {
  const action = new URL(request.url).searchParams.get("action") || "status";
  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const decision = workbenchTextDecision(action, body, request.method);
  return json(decision.body, decision.status);
}

export const Route = createFileRoute("/api/generation")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
