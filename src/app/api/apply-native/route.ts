import { cancelEditJob, getEditJob, startEditJob, decideEditJob, testEditJob } from "@/lib/edit-jobs";
import { endpoint, boundedBody, jsonBody } from "@/server/security/http";
import { requireAccount } from "@/server/codex/client";
import { requireIsolation } from "@/server/codex/isolation";

export const POST = endpoint(async request => {
  await requireAccount();
  await requireIsolation();
  const form = await (await boundedBody(request, 301 * 1024 * 1024)).formData();
  const rawVideo = form.get("rawVideo"), reference = form.get("reference");
  const prompt = String(form.get("prompt") ?? "");
  const referenceUrl = String(form.get("referenceUrl") ?? "").trim();
  if (referenceUrl.length > 2048) throw new Error("Keep the public reference link under 2,048 characters.");
  if (prompt.length > 8000) throw new Error("Keep instructions under 8,000 characters.");
  if (reference instanceof File && reference.size > 100 * 1024 * 1024) throw new Error("Reference must be 100 MB or smaller.");
  if (rawVideo instanceof File && rawVideo.size > 200 * 1024 * 1024) throw new Error("Footage must be 200 MB or smaller.");
  const id = await startEditJob({ projectId: String(form.get("projectId") ?? ""), clipId: String(form.get("clipId") ?? ""),
    rawVideo: rawVideo instanceof File ? rawVideo : null, reference: reference instanceof File ? reference : null,
    recipeId: String(form.get("recipeId") ?? ""), referenceUrl, prompt });
  return Response.json({ id }, { status: 202 });
});
export const GET = endpoint(async request => {
  const url = new URL(request.url);
  return Response.json(await getEditJob(url.searchParams.get("id") ?? "", Number(url.searchParams.get("since") ?? 0)));
});
export const DELETE = endpoint(async request => Response.json(await cancelEditJob(new URL(request.url).searchParams.get("id") ?? "")));
export const PATCH = endpoint(async request => {
  await requireAccount();
  const body = await jsonBody<{ id: string; action: "approve" | "discard" | "open-test-copy"; revision: string }>(request);
  if (body.action === "open-test-copy") return Response.json(await testEditJob(body.id, body.revision));
  return Response.json(await decideEditJob(body.id, body.action, body.revision));
});
