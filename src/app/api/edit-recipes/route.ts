import { listEditRecipes, saveEditRecipe } from "@/lib/edit-jobs";
import { endpoint, jsonBody } from "@/server/security/http";
export const GET = endpoint(async () => Response.json({ recipes: await listEditRecipes() }));
export const POST = endpoint(async request => {
  const body = await jsonBody<{ jobId?: string; name?: string }>(request);
  return Response.json({ recipe: await saveEditRecipe(body.jobId ?? "", body.name ?? "") });
});
