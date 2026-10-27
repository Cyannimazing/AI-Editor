import { endpoint } from "@/server/security/http";
import { accountStatus, startLogin } from "@/server/codex/client";
export const GET = endpoint(async () => Response.json(await accountStatus()));
export const POST = endpoint(async () => Response.json(await startLogin()));
