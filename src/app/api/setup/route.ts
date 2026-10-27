import { endpoint } from "@/server/security/http";
import { setupStatus, startSetup } from "@/server/setup/service";
export const GET = endpoint(async () => Response.json(await setupStatus()));
export const POST = endpoint(async () => Response.json(await startSetup(), { status: 202 }));
