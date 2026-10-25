import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { listProjects, readProjectDraft, resolveTimelineClip } from "./keyframe-helper";
import { referenceFrames } from "./reference-media";
import { capcutSession, commitNativeCandidate, nativeDigest, readNativeDraft, runReferenceEditLoop } from "./reference-edit-loop";

const run = promisify(execFile);
const workspace = process.cwd();
const cli = join(workspace, "toolchain", "node_modules", "capcut-cli", "dist", "index.js");
const ffmpeg = join(workspace, ".local-tools", "bin", "ffmpeg.exe");
const ffprobe = join(workspace, ".local-tools", "bin", "ffprobe.exe");
const activeProjects = new Set<string>();
let desktopInUse = false;

type ApplyInput = {
  projectId: string;
  rawVideo?: File | null;
  clipId?: string;
  prompt: string;
  reference?: File | null;
  savedReferencePath?: string | null;
  savedPlanPath?: string;
  savedBuildDirectory?: string;
  savedSourcePath?: string;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  onCommit?: () => void;
};

async function capCutIsRunning() {
  if (process.platform !== "win32") return false;
  const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq CapCut.exe", "/FO", "CSV", "/NH"]);
  return stdout.toLowerCase().includes('"capcut.exe"');
}

async function capcut(args: string[], timeout = 120_000, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await run(process.execPath, [cli, ...args], { cwd: workspace, timeout, maxBuffer: 4_000_000, signal });
    } catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      if (args[0] === "lint") {
        const output = String((error as { stdout?: string }).stdout ?? "");
        try {
          if ((JSON.parse(output) as { ok?: boolean }).ok) return { stdout: output, stderr: String((error as { stderr?: string }).stderr ?? "") };
        } catch { /* Preserve the original command error if lint returned invalid JSON. */ }
      }
      if (attempt === 3 || !/EPERM: operation not permitted, rename/.test(message) ||
        !/\.bak\.capcut-cli-[^\s]*\.tmp/.test(message)) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
    }
  }
  throw new Error("CapCut command failed.");
}

function inside(folder: string, file: string) {
  const offset = relative(folder, file);
  return offset !== ".." && !offset.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(offset);
}

async function sampleVideo(source: string, folder: string, prefix: string, duration: number, count: number, signal?: AbortSignal) {
  const images: string[] = [];
  for (let index = 0; index < count; index++) {
    const at = Math.max(0, Math.min(duration - 0.04, duration * index / Math.max(1, count - 1)));
    const image = join(folder, `${prefix}-${index}.png`);
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(3), "-i", source,
      "-frames:v", "1", "-vf", "scale=360:-2,format=rgb24", image], { timeout: 30_000, maxBuffer: 1_000_000, signal });
    images.push(image);
  }
  return images;
}

async function referenceInput(file: File | null | undefined, savedPath: string | null | undefined, folder: string, signal?: AbortSignal) {
  if (!file && !savedPath) throw new Error("Attach a reference video or select a saved skill.");
  if (savedPath && (!inside(join(workspace, ".local-tools", "native-assets"), resolve(savedPath)) || !existsSync(savedPath))) {
    throw new Error("The saved skill reference is unavailable.");
  }
  if (file && savedPath) throw new Error("Choose either a new reference or a saved skill.");
  const extension = extname(file?.name ?? savedPath ?? "").toLowerCase();
  const path = join(folder, `reference${extension}`);
  if (savedPath) await cp(savedPath, path);
  if (!file) {
    if (![".mp4", ".mov", ".mkv", ".webm", ".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      throw new Error("The saved reference format is unsupported.");
    }
  }
  if (file) {
    if (file.size > 100 * 1024 * 1024) throw new Error("Reference video must be 100 MB or smaller.");
    if (![".mp4", ".mov", ".mkv", ".webm", ".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      throw new Error("Attach a video or image reference.");
    }
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
  }
  if (![".mp4", ".mov", ".mkv", ".webm"].includes(extension)) return { path, frames: [path], hasAudio: false };
  return referenceFrames(path, folder, signal);
}

export async function applyNativeCapCut(input: ApplyInput) {
  input.signal?.throwIfAborted();
  if (!input.projectId || (!input.clipId && !(input.rawVideo instanceof File)) || !input.prompt?.trim()) {
    throw new Error("Select a project and timeline clip or raw video, then attach a reference and enter your prompt.");
  }
  if (input.rawVideo && (input.rawVideo.size > 200 * 1024 * 1024 || ![".mp4", ".mov", ".mkv", ".webm"].includes(extname(input.rawVideo.name).toLowerCase()))) {
    throw new Error("Raw footage must be an MP4, MOV, MKV, or WebM file under 200 MB.");
  }
  if (activeProjects.has(input.projectId)) throw new Error("This CapCut project is already being edited.");
  if (desktopInUse) throw new Error("Another native CapCut edit is using the desktop. Wait for it to finish or cancel it.");
  activeProjects.add(input.projectId);
  desktopInUse = true;
  try {
    input.onLog?.("Closing CapCut and waiting for it to finish saving before preparing the candidate.");
    await capcutSession("close", undefined, input.signal);
    const project = (await listProjects()).find((item) => item.id === input.projectId);
    if (!project) throw new Error("Selected CapCut project was not found. Refresh projects.");
    const snapshot = await readProjectDraft(project.id);
    const selected = input.clipId ? await resolveTimelineClip(project.id, input.clipId) : null;
    if (project.hasTimelineContent && !selected) throw new Error("Select the timeline clip to edit in this project.");
    if (selected && selected.draft.materials?.speeds?.some((speed) =>
      selected.segment.extra_material_refs?.includes(speed.id) && speed.curve_speed)) {
      throw new Error("This clip uses a speed curve. Choose a clip with constant playback speed; the project was not changed.");
    }
    const originalDigest = await nativeDigest(project.path);
    const original = (await readNativeDraft(project.path)).draft;
    const assertOriginalUnchanged = async () => {
      if (await nativeDigest(project.path) !== originalDigest) throw new Error("The original timeline changed during the run. The candidate will not replace it.");
    };
    const jobs = join(workspace, ".local-tools", "native-assets");
    const stagingRoot = join(workspace, ".local-tools", "staging");
    const backupRoot = join(workspace, ".local-tools", "backups");
    await Promise.all([mkdir(jobs, { recursive: true }), mkdir(stagingRoot, { recursive: true }), mkdir(backupRoot, { recursive: true })]);
    const job = await mkdtemp(join(jobs, "edit-"));
    const source = join(job, selected ? "raw.mp4" : `raw${extname(input.rawVideo!.name).toLowerCase()}`);
    if (selected) {
      input.onLog?.(`Preparing only ${selected.material.material_name || "the selected clip"} at ${(selected.segment.target_timerange.start / 1_000_000).toFixed(2)}s on the timeline.`);
      const targetSeconds = selected.segment.target_timerange.duration / 1_000_000;
      const sourceSeconds = (selected.segment.source_timerange?.duration ?? selected.segment.target_timerange.duration) / 1_000_000;
      const speed = sourceSeconds / targetSeconds;
      if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(targetSeconds) || targetSeconds < 0.1) throw new Error("The selected clip has invalid timing.");
      const { stdout: sourceProbe } = await run(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", selected.mediaPath], { timeout: 15000, signal: input.signal });
      const hasAudio = (JSON.parse(sourceProbe) as { streams?: { codec_type: string }[] }).streams?.some((stream) => stream.codec_type === "audio");
      const audioFilters: string[] = selected.segment.reverse ? ["areverse"] : [];
      let tempo = speed;
      while (tempo < 0.5) { audioFilters.push("atempo=0.5"); tempo /= 0.5; }
      while (tempo > 2) { audioFilters.push("atempo=2"); tempo /= 2; }
      audioFilters.push(`atempo=${tempo}`);
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String((selected.segment.source_timerange?.start ?? 0) / 1_000_000),
        "-t", String(sourceSeconds), "-i", selected.mediaPath, "-map", "0:v:0", "-map", "0:a?",
        "-vf", `${selected.segment.reverse ? "reverse," : ""}setpts=(PTS-STARTPTS)/${speed}`,
        ...(hasAudio ? ["-af", audioFilters.join(",")] : []), "-t", String(targetSeconds),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", source],
      { timeout: 180_000, maxBuffer: 2_000_000, signal: input.signal });
    } else await writeFile(source, Buffer.from(await input.rawVideo!.arrayBuffer()));
    const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", source],
      { timeout: 30_000, maxBuffer: 1_000_000, signal: input.signal });
    const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: {
      codec_type?: string; width?: number; height?: number;
    }[] };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration < 0.1 || !video?.width || !video?.height || video.width < 64 || video.height < 64) {
      throw new Error("The raw footage does not contain a readable video stream.");
    }
    if (selected && Math.abs(duration * 1_000_000 - selected.segment.target_timerange.duration) > 100_000) throw new Error("The extracted clip did not match its timeline duration.");
    const canvas = selected?.draft.canvas_config;
    const media = { path: source, width: canvas?.width || video.width, height: canvas?.height || video.height,
      durationUs: selected?.segment.target_timerange.duration ?? Math.round(duration * 1_000_000) };
    input.onLog?.("Extracting the reference timeline, including consecutive frames for short transitions.");
    const reference = await referenceInput(input.reference, input.savedReferencePath, job, input.signal);
    const targetFrames = await sampleVideo(source, job, "target-frame", duration, 3, input.signal);
    if (input.savedPlanPath && (!inside(join(workspace, ".local-tools", "skills"), resolve(input.savedPlanPath)) ||
      !input.savedBuildDirectory || !inside(jobs, resolve(input.savedBuildDirectory)))) throw new Error("The saved skill's build sources are unavailable.");
    const staging = await mkdtemp(join(stagingRoot, "candidate-"));
    await cp(project.path, staging, { recursive: true });
    await run(process.execPath, [join(workspace, "scripts", "capcut-draft.mjs"), "isolate", staging], { timeout: 30000, signal: input.signal });
    const loop = await runReferenceEditLoop({ job, candidate: staging, original, source, width: media.width, height: media.height,
      duration: media.durationUs / 1_000_000, start: (selected?.segment.target_timerange.start ?? 0) / 1_000_000,
      clipId: input.clipId, originalSource: selected?.mediaPath, prompt: input.prompt, reference, targetFrames, savedPlan: input.savedPlanPath,
      savedBuildDirectory: input.savedBuildDirectory, savedSourcePath: input.savedSourcePath,
      onLog: input.onLog ?? (() => undefined), signal: input.signal, assertOriginalUnchanged });
    const { manifest } = loop;
    input.signal?.throwIfAborted();
    const stagedLint = JSON.parse((await capcut(["lint", staging, "--json"], 120_000, input.signal)).stdout) as { ok: boolean };
    if (!stagedLint.ok) throw new Error("The staged CapCut edit did not pass draft validation. The project was not changed.");
    if (await capCutIsRunning()) throw new Error("CapCut reopened while planning. Close it and run again; the project was not changed.");
    await assertOriginalUnchanged();
    if ((await readProjectDraft(project.id)).raw !== snapshot.raw) throw new Error("The CapCut timeline changed while planning. Refresh and run again; no edit was written.");
    const backup = join(backupRoot, `${project.id}-${randomUUID()}`);
    await cp(project.path, backup, { recursive: true });
    input.signal?.throwIfAborted();
    input.onCommit?.();
    try {
      input.onLog?.("Native comparison passed. CapCut is closed; backing up and committing the verified candidate.");
      await commitNativeCandidate(staging, project.path);
      const liveLint = JSON.parse((await capcut(["lint", project.path, "--json"])).stdout) as { ok: boolean };
      if (!liveLint.ok) throw new Error("The updated CapCut draft failed validation.");
    } catch (error) {
      await capcutSession("close");
      await cp(backup, project.path, { recursive: true, force: true });
      throw new Error(`The edit failed and the backup was restored. ${error instanceof Error ? error.message : String(error)}`);
    }
    let reopenNote = "";
    try { await capcutSession("open", project.path); }
    catch { reopenNote = " The edit was committed; open the project manually to review it."; }
    input.onLog?.("Verified native edit committed. The original project backup and comparison evidence are retained.");
    return { projectId: project.id, projectName: project.name, applied: manifest.effects.map((effect) => effect.technique),
      toolsUsed: manifest.toolsUsed, notes: manifest.notes + reopenNote, backup, jobPath: job,
      referencePath: reference.path, effects: manifest.effects, prompt: input.prompt, sourceName: selected?.material.material_name || input.rawVideo?.name || "Timeline clip",
      model: loop.model, access: loop.access, iterations: loop.iterations, verified: true, evidencePath: loop.evidencePath };
  } finally {
    activeProjects.delete(input.projectId);
    desktopInUse = false;
  }
}
