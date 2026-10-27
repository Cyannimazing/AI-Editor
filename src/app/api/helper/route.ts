import { listProjects, openCapCutProject, createLocalProject } from "@/lib/keyframe-helper";
import { endpoint, jsonBody } from "@/server/security/http";
import { requireAccount } from "@/server/codex/client";
export const GET = endpoint(async request => Response.json({ projects: await listProjects(new URL(request.url).searchParams.get("includeLocal") === "1") }));
export const POST = endpoint(async request => {
  const body = await jsonBody<{ action?: string; projectId?: string }>(request);
  await requireAccount();
  if (body.action === "create-local-project") return Response.json(await createLocalProject());
  if (body.action !== "open-project" || !body.projectId) throw new Error("Choose a project to open.");
  return Response.json({ result: await openCapCutProject(body.projectId) });
});
