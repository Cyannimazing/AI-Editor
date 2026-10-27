import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const runtime = globalThis as typeof globalThis & { __editorSessionSecret?: Buffer };
const secret = runtime.__editorSessionSecret ??= randomBytes(32);
const cookieName = "ai-editor-session";
const lifetime = 12 * 60 * 60 * 1000;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function assertLocalOrigin(request: Request, mutation = !["GET", "HEAD"].includes(request.method)) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new HttpError(403, "Open AI-Editor on localhost.");
  if (request.headers.get("host") !== url.host) throw new HttpError(403, "Invalid host.");
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) throw new HttpError(403, "Cross-origin access is not allowed.");
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || (mutation && origin !== url.origin)) throw new HttpError(403, "A same-origin request is required.");
  if (mutation && request.headers.get("x-ai-editor") !== "1") throw new HttpError(403, "Missing request protection.");
}

function signature(value: string) { return createHmac("sha256", secret).update(value).digest("hex"); }

export function sessionResponse(request: Request) {
  assertLocalOrigin(request, true);
  const value = `${Date.now()}.${randomBytes(24).toString("hex")}`;
  return Response.json({ ready: true }, { headers: {
    "Set-Cookie": `${cookieName}=${value}.${signature(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetime / 1000}`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}

export function authorize(request: Request) {
  assertLocalOrigin(request);
  const token = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const match = /^(\d+)\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token ?? "");
  if (!match || Date.now() - Number(match[1]) > lifetime || Number(match[1]) > Date.now() ||
    !timingSafeEqual(Buffer.from(match[3], "hex"), Buffer.from(signature(`${match[1]}.${match[2]}`), "hex"))) {
    throw new HttpError(401, "Your local session expired. Reload AI-Editor.");
  }
}

export function endpoint(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { authorize(request); const response = await handler(request); response.headers.set("Cache-Control", "no-store"); return response; }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: error instanceof HttpError ? error.status : 400 }); }
  };
}

/** Count actual bytes, including chunked requests, before multipart parsing. */
export async function boundedBody(request: Request, limit: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new HttpError(413, "Upload exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request body.");
  let expired = false;
  const deadline = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 120_000);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (expired) throw new HttpError(408, "Upload timed out. Try a smaller file."); if (done) break; length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, "Upload exceeds the size limit."); } chunks.push(value); }
  } finally { clearTimeout(deadline); reader.releaseLock(); }
  return new Response(new Blob(chunks as BlobPart[]), { headers: { "Content-Type": request.headers.get("content-type") ?? "application/octet-stream" } });
}

export async function jsonBody<T>(request: Request): Promise<T> { return (await boundedBody(request, 64 * 1024)).json() as Promise<T>; }
