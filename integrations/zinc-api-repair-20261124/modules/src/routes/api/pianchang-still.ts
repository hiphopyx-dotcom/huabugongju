import { createFileRoute } from "@tanstack/react-router";
import { parseAspect } from "@/lib/jingben-catalog";
import { prepareStageStill, withStageFramePrompt } from "@/lib/stage-still.server";
import { memberViewer, submitMemberJob } from "@/lib/image-provider.server";
import { mapRouteError } from "@/lib/media-route-guard";

const KNOWN_ASPECTS = new Set(["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"]);

function knownAspect(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return { aspect: "16:9" as const };
  const n = text.replace(/\s+/g, "").replace("/", ":");
  if (!KNOWN_ASPECTS.has(n)) return { error: "不支持的画幅: " + text };
  return { aspect: parseAspect(n) || "16:9" };
}

export const Route = createFileRoute("/api/pianchang-still")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        const picked = knownAspect(body?.aspect);
        if ("error" in picked) return Response.json({ ok: false, error: picked.error }, { status: 400 });
        if (body?.prepareOnly === true) {
          return Response.json(prepareStageStill(body || {}));
        }
        let prompt = String(body?.prompt || "").slice(0, 4000).trim();
        const aspect = picked.aspect;
        const resolution = body?.resolution === "1k" ? "1k" : "2k";
        const rawRefs = Array.isArray(body?.refs) ? body.refs : [];
        const usableRef = (item: unknown) =>
          typeof item === "string" && (item.startsWith("data:image/") || /^https?:\/\//i.test(item));
        if (rawRefs.length > 0 && rawRefs.some((item: unknown) => !usableRef(item))) {
          return Response.json({ ok: false, error: "参考图不是可用的图片数据，没有发送" }, { status: 400 });
        }
        const refs = rawRefs.filter(usableRef).slice(0, 4);
        const stageFrame = body?.stageFrame === true && refs.length > 0;
        if (stageFrame) prompt = withStageFramePrompt(prompt, true);
        if (!prompt) return Response.json({ ok: false, error: "没有画面要求" }, { status: 400 });
        try {
          const viewer = await memberViewer(request);
          const result = await submitMemberJob({
            kind: "image",
            prompt,
            aspect,
            resolution,
            refs,
            origin: "canvas",
            projectId: body?.projectId,
            projectName: body?.projectName,
            name: body?.name,
            entityKind: body?.entityKind,
            shotNo: body?.shotNo,
          }, "image", viewer);
          const { status, ...rest } = result;
          return Response.json(rest, { status: status || 503 });
        } catch (error) {
          const mapped = mapRouteError(error);
          return Response.json(mapped.body, { status: mapped.status });
        }
      },
    },
  },
});
