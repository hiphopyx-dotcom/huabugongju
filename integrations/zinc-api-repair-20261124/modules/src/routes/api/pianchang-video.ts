import { createFileRoute } from "@tanstack/react-router";
import { memberViewer, readMemberJob, submitMemberJob } from "@/lib/image-provider.server";
import { mapRouteError, missingJobDecision } from "@/lib/media-route-guard";

const ASPECTS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]);
const MISSING = "出视频队列还没有准备好，没有提交";

function frameOf(value: unknown) {
  return typeof value === "string" && (/^data:image\//.test(value) || /^https?:\/\//.test(value)) ? value : "";
}

export const Route = createFileRoute("/api/pianchang-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        const prompt = String(body?.prompt || "").slice(0, 4000).trim();
        const aspect = ASPECTS.has(String(body?.aspect || "")) ? String(body.aspect) : "16:9";
        const image = frameOf(body?.image);
        const lastFrame = frameOf(body?.last_frame) || frameOf(body?.lastFrame);
        const referenceImages = (Array.isArray(body?.reference_images) ? body.reference_images : [])
          .map((item: unknown) => (typeof item === "string" ? item : item && typeof item === "object" && typeof (item as { url?: string }).url === "string" ? (item as { url: string }).url : ""))
          .filter((url: string) => /^data:image\//.test(url) || /^https?:\/\//.test(url))
          .slice(0, 14);
        const video = typeof body?.video === "string" && (/^data:video\//.test(body.video) || /^https?:\/\//.test(body.video)) ? body.video : "";
        if (!prompt) return Response.json({ ok: false, error: "没有画面要求" }, { status: 400 });
        const refs = [image, lastFrame, ...referenceImages].filter(Boolean);
        try {
          const viewer = await memberViewer(request);
          const result = await submitMemberJob({
            kind: "video",
            prompt,
            aspect,
            resolution: String(body?.resolution || ""),
            refs,
            origin: "canvas",
            duration: Number(body?.duration) || 5,
            image,
            lastFrame,
            referenceImages,
            video,
            audio: body?.audio !== false,
          }, "video", viewer);
          const { status, ...rest } = result;
          return Response.json({ ...rest, error: rest.ok ? undefined : (rest.error || MISSING) }, { status: status || 503 });
        } catch (error) {
          const mapped = mapRouteError(error);
          return Response.json(mapped.body, { status: mapped.status });
        }
      },
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") || "";
        const missing = missingJobDecision(id);
        if (missing) return Response.json(missing.body, { status: missing.http });
        try {
          const result = await readMemberJob(id, request, "video");
          return Response.json(result.body, { status: result.http });
        } catch (error) {
          const mapped = mapRouteError(error);
          return Response.json(mapped.body, { status: mapped.status });
        }
      },
    },
  },
});
