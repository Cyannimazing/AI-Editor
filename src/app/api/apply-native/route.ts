import { getEditJob, startEditJob } from "@/lib/edit-jobs";

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

export async function POST(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Local access only." }, { status: 403 });
  try {
    const form = await request.formData();
    const rawVideo = form.get("rawVideo");
    const reference = form.get("reference");
    const clipId = String(form.get("clipId") ?? "");
    if (!clipId && !(rawVideo instanceof File)) throw new Error("Select a timeline clip or attach raw video footage.");
    const id = await startEditJob({
      projectId: String(form.get("projectId") ?? ""),
      rawVideo: rawVideo instanceof File ? rawVideo : null,
      clipId,
      reference: reference instanceof File ? reference : null,
      recipeId: String(form.get("recipeId") ?? ""),
      prompt: String(form.get("prompt") ?? ""),
    });
    return Response.json({ id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start the edit." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Local access only." }, { status: 403 });
  try {
    const url = new URL(request.url);
    return Response.json(await getEditJob(url.searchParams.get("id") ?? "", Number(url.searchParams.get("since") ?? 0)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the edit job." }, { status: 400 });
  }
}
