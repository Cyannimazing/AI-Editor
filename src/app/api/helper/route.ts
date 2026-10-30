import { discoverProjects, projectCompatibilityReport, openCapCutProject, createLocalProject } from "@/lib/keyframe-helper";
import { endpoint, jsonBody } from "@/server/security/http";
import { requireAccount } from "@/server/codex/client";
export const GET = endpoint(async request => {
  const params = new URL(request.url).searchParams;
  if (params.get('download') === 'compatibility') {
    const projectId = params.get('projectId');
    if (!projectId || projectId.length > 256) throw new Error('Choose a project for the report.');
    return Response.json(await projectCompatibilityReport(projectId, request.signal), {
      headers: { 'Content-Disposition': 'attachment; filename="ai-editor-compatibility.json"' },
    });
  }
  return Response.json(await discoverProjects(params.get('includeLocal') === '1', request.signal));
});
export const POST = endpoint(async request => {
  const body = await jsonBody<{ action?: string; projectId?: string }>(request);
  await requireAccount();
  if (body.action === "create-local-project") return Response.json(await createLocalProject());
  if (body.action !== "open-project" || !body.projectId) throw new Error("Choose a project to open.");
  return Response.json({ result: await openCapCutProject(body.projectId) });
});
