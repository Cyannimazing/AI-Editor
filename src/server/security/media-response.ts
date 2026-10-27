import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** Serve one already-authorized media path, with seek support and bounded reads. */
export async function mediaResponse(request: Request, path: string, type = "video/mp4") {
  const file = await stat(path);
  if (!file.isFile()) throw new Error("Media unavailable.");
  const range = request.headers.get("range");
  let start = 0, end = file.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
  }
  const headers: Record<string, string> = { "Content-Type": type, "Content-Length": String(Math.max(0, end - start + 1)),
    "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  const stream = file.size ? Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array> : null;
  return new Response(stream, { status: range ? 206 : 200, headers });
}
