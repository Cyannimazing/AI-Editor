import { HttpError, sessionResponse } from "@/server/security/http";

export async function POST(request: Request) {
  try { return sessionResponse(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Session failed." }, { status: error instanceof HttpError ? error.status : 500 }); }
}
