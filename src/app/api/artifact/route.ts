import { jobArtifact } from "@/lib/edit-jobs";
import { endpoint } from "@/server/security/http";
import { containedPath } from "@/server/security/paths";
import { mediaResponse } from "@/server/security/media-response";
import { join } from "node:path";

export const GET = endpoint(async request => {
  const url = new URL(request.url);
  const artifact = await jobArtifact(url.searchParams.get("id") ?? "", "preview");
  const root = await containedPath(join(process.cwd(), ".local-tools", "native-assets"), artifact.root);
  return mediaResponse(request, await containedPath(root, artifact.path));
});
