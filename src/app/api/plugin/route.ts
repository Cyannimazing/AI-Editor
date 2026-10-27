import { endpoint, jsonBody } from "@/server/security/http";
import { capcutPluginStatus, connectCapcut, searchCapcutMaterials } from "@/server/capcut/plugin";
export const GET = endpoint(async () => Response.json(await capcutPluginStatus()));
export const POST = endpoint(async request => {
  const body = await jsonBody<{ action?: string; query?: string; kind?: string }>(request);
  if (body.action === "connect") {
    const login = await connectCapcut();
    return Response.json({ state: login.state, url: login.url, expiresAt: login.expiresAt, detail: login.detail });
  }
  if (body.action === "search-materials") return Response.json(await searchCapcutMaterials({ query: body.query || "", kind: body.kind || "" }));
  throw new Error("Unknown CapCut connection action.");
});
