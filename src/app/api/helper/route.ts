import { listProjects, openCapCutProject } from "@/lib/keyframe-helper";

function localRequest(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      (!origin || new URL(origin).host === url.host);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Local access only." }, { status: 403 });
  return Response.json({ projects: await listProjects() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Local access only." }, { status: 403 });
  try {
    const body = await request.json() as { action?: string; projectId?: string };
    if (body.action !== "open-project" || !body.projectId) throw new Error("Choose a project to open.");
    return Response.json({ result: await openCapCutProject(body.projectId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not open CapCut." }, { status: 400 });
  }
}
