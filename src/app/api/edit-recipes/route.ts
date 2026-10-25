import { listEditRecipes, saveEditRecipe } from "@/lib/edit-jobs";

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
  return Response.json({ recipes: await listEditRecipes() });
}

export async function POST(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Local access only." }, { status: 403 });
  try {
    const body = await request.json() as { jobId?: string; name?: string };
    return Response.json({ recipe: await saveEditRecipe(body.jobId ?? "", body.name ?? "") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the recipe." }, { status: 400 });
  }
}
