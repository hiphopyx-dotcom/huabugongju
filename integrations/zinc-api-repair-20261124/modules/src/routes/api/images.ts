import { createFileRoute } from "@tanstack/react-router";
import { choiceView, memberViewer, providerStatus, readMemberJob, saveChoice, submitMemberJob } from "@/lib/image-provider.server";
import { emptyPromptDecision, mapRouteError, missingJobDecision } from "@/lib/media-route-guard";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: unknown, fallback: string) {
  const status = Number((error as { status?: number })?.status) || 400;
  return json({ error: error instanceof Error ? error.message : fallback }, status);
}

export const Route = createFileRoute("/api/images")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const action = new URL(request.url).searchParams.get("action") || "status";
        if (action === "status") return json(await providerStatus());
        if (action === "choice") return json(await choiceView(request));
        if (action === "job") {
          const id = new URL(request.url).searchParams.get("id") || "";
          const missing = missingJobDecision(id);
          if (missing) return json(missing.body, missing.http);
          const kind = new URL(request.url).searchParams.get("kind") === "video" ? "video" : "image";
          try {
            const result = await readMemberJob(id, request, kind);
            return json(result.body, result.http);
          } catch (error) {
            const mapped = mapRouteError(error);
            return json(mapped.body, mapped.status);
          }
        }
        return json({ error: "没有这个操作" }, 404);
      },
      POST: async ({ request }) => {
        const action = new URL(request.url).searchParams.get("action") || "";
        const body = await request.json().catch(() => null);
        if (action === "choice") {
          try {
            return json(await saveChoice(request, body || {}));
          } catch (error) {
            return fail(error, "只有管理员能改出图方式");
          }
        }
        if (action !== "generate") return json({ error: "没有这个操作" }, 404);
        const record = body && typeof body === "object" ? body : {};
        const missing = emptyPromptDecision(record);
        if (missing) return json(missing.body, missing.status);
        try {
          const viewer = await memberViewer(request);
          const result = await submitMemberJob({ ...record, kind: "image" }, "image", viewer);
          const { status, ...rest } = result;
          return json(rest, status || 503);
        } catch (error) {
          const mapped = mapRouteError(error);
          return json(mapped.body, mapped.status);
        }
      },
    },
  },
});
