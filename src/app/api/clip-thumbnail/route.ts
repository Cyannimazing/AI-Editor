import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveTimelineClip } from "@/lib/keyframe-helper";

const run = promisify(execFile);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response(null, { status: 403 });
  try {
    const clip = await resolveTimelineClip(url.searchParams.get("projectId") ?? "", url.searchParams.get("clipId") ?? "");
    const sourceStart = (clip.segment.source_timerange?.start ?? 0) / 1_000_000;
    const sourceStat = await stat(clip.mediaPath);
    const key = createHash("sha256").update(`${clip.mediaPath}:${sourceStart}:${sourceStat.mtimeMs}`).digest("hex");
    const folder = join(process.cwd(), ".local-tools", "thumbnails");
    const path = join(folder, `${key}.png`);
    let data: Buffer;
    try { data = await readFile(path); }
    catch {
      await mkdir(folder, { recursive: true });
      await run(join(process.cwd(), ".local-tools", "bin", "ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-y",
        "-ss", String(sourceStart), "-i", clip.mediaPath, "-frames:v", "1", "-vf", "scale=160:-2,format=rgb24", path],
      { timeout: 20_000, maxBuffer: 500_000 });
      data = await readFile(path);
    }
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
