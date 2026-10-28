import { listEditRecipes } from "@/lib/edit-jobs";
import { endpoint } from "@/server/security/http";
export const GET = endpoint(async () => Response.json({ recipes: await listEditRecipes() }));
export const POST = endpoint(async () => Response.json({ error: "Reusable techniques are deferred for this release. Existing saved data is retained." }, { status: 409 }));
