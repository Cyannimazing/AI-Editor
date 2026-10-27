import { mediaTool } from "../server/platform/runtime.mjs";
import { preparePictureMedia } from "../server/editing/picture-framing.mjs";
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function referenceFrames(source: string, job: string, signal?: AbortSignal,
  framing?: { fillPicture: boolean; canvas: { width: number; height: number } }) {
  const folder = join(job, "reference-frames");
  await mkdir(folder, { recursive: true });
  const originalSource = source;
  const picture = framing?.fillPicture
    ? await preparePictureMedia({ source, job, name: 'reference-picture', canvas: framing.canvas, signal }) : undefined;
  if (picture) source = picture.path;
  const { stdout } = await run(mediaTool("ffprobe"), ["-v", "error", "-show_entries",
    "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate", "-of", "json", source], { timeout: 30000, signal });
  const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: {
    codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string;
  }[] };
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(probe.format?.duration);
  const [numerator, denominator] = (video?.avg_frame_rate || video?.r_frame_rate || "30/1").split("/").map(Number);
  const nativeFps = numerator / denominator;
  if (!video || !Number.isFinite(duration) || duration < 0.1) throw new Error("The reference video could not be read.");
  if (duration > 600) throw new Error("Use a reference excerpt up to ten minutes long so every technique can be reviewed.");
  const fps = duration <= 12 ? Math.min(60, Number.isFinite(nativeFps) && nativeFps > 0 ? nativeFps : 30) : 2;
  await run(mediaTool("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-vf", `fps=${fps},scale=720:-2,format=rgb24`, join(folder, "frame-%05d.png")],
  { timeout: 180000, maxBuffer: 1000000, signal });
  const frames = (await readdir(folder)).filter((file) => /^frame-\d+\.png$/.test(file)).sort();
  if (!frames.length) throw new Error("No reference frames were extracted.");
  await run(mediaTool("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps),
    "-i", join(folder, "frame-%05d.png"), "-vf", "scale=180:-2,tile=6x6:nb_frames=36:padding=4:margin=4",
    join(folder, "sheet-%03d.png")], { timeout: 180000, maxBuffer: 1000000, signal });
  const sheets = (await readdir(folder)).filter((file) => /^sheet-\d+\.png$/.test(file)).sort().map((file) => join(folder, file));
  let audioPath: string | null = null;
  if (probe.streams?.some((stream) => stream.codec_type === "audio")) {
    audioPath = join(job, "reference-audio.wav");
    await run(mediaTool("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-i", source,
      "-vn", "-ac", "1", "-ar", "16000", audioPath], { timeout: 120000, signal });
  }
  const index = {
    source, originalSource, framing: picture?.receipt, duration, width: video.width, height: video.height, nativeFps, sampleFps: fps,
    sampling: duration <= 12 ? "consecutive frames at up to 60fps" : "2fps overview; extract consecutive frames around every technique before building",
    audioPath, frames: frames.map((file, index) => ({ path: join(folder, file), time: index / fps })),
    sheets: sheets.map((path, index) => ({ path, firstFrame: index * 36 + 1, layout: "6 columns, left to right, then down" })),
  };
  const indexPath = join(job, "reference-frames.json");
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  // Cover the whole reference. Taking the first eight sheets silently hid the ending.
  const selected = sheets.length <= 8 ? sheets : Array.from({ length: 8 }, (_, index) => sheets[Math.round(index * (sheets.length - 1) / 7)]);
  return { path: source, frames: selected, indexPath, duration, hasAudio: Boolean(audioPath) };
}
