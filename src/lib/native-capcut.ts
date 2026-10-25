import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { editingToolContext } from "./editing-context";
import { listProjects } from "./keyframe-helper";
import { codexExecutable, runCodexStream } from "./reference-analysis";

const run = promisify(execFile);
const workspace = process.cwd();
const cli = join(workspace, "toolchain", "node_modules", "capcut-cli", "dist", "index.js");
const ffmpeg = join(workspace, ".local-tools", "bin", "ffmpeg.exe");
const ffprobe = join(workspace, ".local-tools", "bin", "ffprobe.exe");
const activeProjects = new Set<string>();

type ApplyInput = {
  projectId: string;
  rawVideo: File;
  prompt: string;
  reference?: File | null;
  savedReferencePath?: string | null;
  onLog?: (line: string) => void;
};

type SpecItem = { path?: string; ref?: string; start: number; duration: number };
type SpecTrack = { name: string; type: string; items: SpecItem[] };
type Spec = { width: number; height: number; fps: number; tracks: SpecTrack[]; operations?: unknown[] };
type Manifest = {
  supported: boolean;
  effects: { technique: string; trackNames: string[]; method: string }[];
  toolsUsed: string[];
  limitations: string[];
  notes: string;
};

async function capCutIsRunning() {
  if (process.platform !== "win32") return false;
  const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq CapCut.exe", "/FO", "CSV", "/NH"]);
  return stdout.toLowerCase().includes('"capcut.exe"');
}

async function capcut(args: string[], timeout = 120_000) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await run(process.execPath, [cli, ...args], { cwd: workspace, timeout, maxBuffer: 4_000_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

async function sampleVideo(source: string, folder: string, prefix: string, duration: number, count: number) {
  const images: string[] = [];
  for (let index = 0; index < count; index++) {
    const at = Math.max(0, Math.min(duration - 0.04, duration * (index + 0.5) / count));
    const image = join(folder, `${prefix}-${index}.png`);
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(3), "-i", source,
      "-frames:v", "1", "-vf", "scale=360:-2,format=rgb24", image], { timeout: 30_000, maxBuffer: 1_000_000 });
    images.push(image);
  }
  return images;
}

async function referenceInput(file: File | null | undefined, savedPath: string | null | undefined, folder: string) {
  if (!file && !savedPath) throw new Error("Attach a reference video or select a saved recipe.");
  if (savedPath && (!inside(join(workspace, ".local-tools", "native-assets"), resolve(savedPath)) || !existsSync(savedPath))) {
    throw new Error("The saved recipe reference is unavailable.");
  }
  if (file && savedPath) throw new Error("Choose either a new reference or a saved recipe.");
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
  if (![".mp4", ".mov", ".mkv", ".webm"].includes(extension)) return { path, frames: [path] };
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
    { timeout: 15_000 });
  const seconds = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(seconds) || seconds < 0.1) throw new Error("The reference video could not be read.");
  return { path, frames: await sampleVideo(path, folder, "reference-frame", seconds, Math.min(12, Math.max(4, Math.ceil(seconds * 4)))) };
}

async function createPlan(input: ApplyInput, media: { path: string; width: number; height: number; durationUs: number }, job: string) {
  const duration = media.durationUs / 1_000_000;
  const reference = await referenceInput(input.reference, input.savedReferencePath, job);
  const targetFrames = await sampleVideo(media.path, job, "target-frame", duration, 3);
  const schema = join(job, "manifest-schema.json");
  const manifestPath = join(job, "manifest.json");
  const specPath = join(job, "spec.json");
  await writeFile(schema, JSON.stringify({
    type: "object", additionalProperties: false,
    required: ["supported", "effects", "toolsUsed", "limitations", "notes"],
    properties: {
      supported: { type: "boolean" },
      effects: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["technique", "trackNames", "method"], properties: {
          technique: { type: "string" }, trackNames: { type: "array", items: { type: "string" } }, method: { type: "string" },
        } } },
      toolsUsed: { type: "array", items: { type: "string" } },
      limitations: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
  }));
  const prompt = [
    "Create a real, reference-driven edit for the selected CapCut draft. The current USER PROMPT and attached reference are the specification. Do not reproduce a canned demo or assume a fixed list of effects. Inspect the actual video before editing. The first images are ordered reference frames; the last three are target frames.",
    `User prompt: ${JSON.stringify(input.prompt.slice(0, 4000))}`,
    "Detect every distinct technique actually visible or audible in the reference and apply the full edit automatically. There is no checkbox selection. The user's prompt may narrow or modify what to copy.",
    `Reference file: ${reference.path ?? "none"}. Target footage: ${media.path}. Target dimensions: ${media.width}x${media.height}; duration ${duration.toFixed(3)}s.`,
    `Write a CapCut CLI compile specification at ${specPath}. First track must be the original footage at the target path, 0s to ${duration.toFixed(3)}s, with ref "source". All generated media assets must be inside ${job}. Do not edit the CapCut project yourself. Do not write outside this job folder.`,
    `Tools: FFmpeg ${ffmpeg}; FFprobe ${ffprobe}; CapCut CLI ${cli}; Remotion ${join(workspace, "toolchain", "node_modules", "@remotion", "cli", "remotion-cli.js")}; HyperFrames ${join(workspace, "toolchain", "node_modules", "hyperframes", "bin", "hyperframes.mjs")}. CapCut CLI docs ${join(workspace, "toolchain", "node_modules", "capcut-cli", "docs", "command-reference.md")}. Create any needed Remotion composition inside this job folder, using the installed packages; no prebuilt composition is required. Read tool docs before use.`,
    `Editing contract:\n${editingToolContext(Boolean(process.env.GROQ_API_KEY))}`,
    "Choose actual tools from the detected techniques. Use native CapCut keyframes/text when they can match. For complex color/channel effects use FFmpeg to produce a separate timed video layer; for animated graphics use Remotion when needed, and HyperFrames for captions or static graphics when needed. Preserve the original footage under hybrid layers. Avoid redundant full-frame layers and do not use a static image for a moving effect. Match timings, positions, shapes, colors, and easing from the reference as closely as the evidence permits. Never invent an effect absent from the prompt/reference.",
    "Inspect the reference across its full duration, including audio if relevant. Render the generated visual assets and inspect representative frames yourself. If any detected technique cannot be done convincingly, return supported=false with specific limitations and do not claim success. Do not use Groq unless configured and speech understanding is needed. Do not use an API key or a credit-billed model; this Codex CLI session uses the signed-in ChatGPT account.",
    "The spec format is {width,height,fps,tracks:[{type,name,items:[{path,ref?,type?,start,duration,...}]}],operations:[...]}. Consult CapCut CLI docs for supported operations. Every technique you report must map to one or more actual track names in your final effects report. Use no external media except the supplied reference for style and the target footage for content. End with the required JSON report.",
  ].join("\n\n");
  await runCodexStream(await codexExecutable(), ["exec", "--ignore-user-config", "--sandbox", "workspace-write",
    "--skip-git-repo-check", "--ephemeral", "--json", "--output-schema", schema, "--output-last-message", manifestPath, "-",
    ...reference.frames.concat(targetFrames).flatMap((frame) => ["--image", frame])], job, prompt,
  input.onLog ?? (() => undefined), 600_000);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (!manifest.supported || manifest.limitations?.length) {
    throw new Error(`Could not apply the full reference edit: ${manifest.limitations?.join("; ") || manifest.notes}`);
  }
  const spec = JSON.parse(await readFile(specPath, "utf8")) as Spec;
  await validatePlan(spec, manifest, media.path, job, media.width, media.height, duration);
  return { specPath, manifest, referencePath: reference.path };
}

async function validatePlan(spec: Spec, manifest: Manifest, source: string, job: string,
  width: number, height: number, duration: number) {
  if (spec.width !== width || spec.height !== height || !Number.isFinite(spec.fps) || spec.fps < 1 || spec.fps > 120 ||
    !Array.isArray(spec.tracks) || !spec.tracks.length || spec.tracks.length > 30 ||
    !Array.isArray(spec.operations ?? []) || (spec.operations?.length ?? 0) > 500) {
    throw new Error("Codex produced an invalid CapCut edit specification.");
  }
  const trackNames = new Set<string>();
  for (const track of spec.tracks) {
    if (!track.name || trackNames.has(track.name) || !["video", "audio", "text"].includes(track.type) ||
      !Array.isArray(track.items) || track.items.length > 200) throw new Error("The generated edit has invalid tracks.");
    trackNames.add(track.name);
    for (const item of track.items) {
      if (!Number.isFinite(item.start) || !Number.isFinite(item.duration) || item.start < 0 ||
        item.duration <= 0 || item.start + item.duration > duration + 0.1) {
        throw new Error("The generated edit contains invalid clip timing.");
      }
      if (item.path) {
        const path = resolve(/*turbopackIgnore: true*/ item.path);
        if (path !== resolve(source) && !inside(job, path)) throw new Error("The edit references media outside its job folder.");
        if (!existsSync(path) || !(await stat(path)).isFile()) throw new Error("A generated media asset is missing.");
      }
    }
  }
  const sourceItem = spec.tracks[0]?.items[0];
  if (spec.tracks[0]?.type !== "video" || !sourceItem || resolve(/*turbopackIgnore: true*/ sourceItem.path ?? "") !== resolve(source) ||
    sourceItem.start !== 0 || Math.abs(sourceItem.duration - duration) > 0.05) {
    throw new Error("The edit must retain the original footage as its first track.");
  }
  if (!Array.isArray(manifest.effects) || !manifest.effects.length ||
    new Set(manifest.effects.map((effect) => effect.technique)).size !== manifest.effects.length ||
    manifest.effects.some((effect) => !effect.method || !effect.trackNames?.length ||
      effect.trackNames.some((name) => !trackNames.has(name)))) {
    throw new Error("The edit plan does not account for every detected technique.");
  }
}

export async function applyNativeCapCut(input: ApplyInput) {
  if (!input.projectId || !(input.rawVideo instanceof File) || !input.prompt?.trim()) {
    throw new Error("Select an empty CapCut project, raw video, and reference, then enter your prompt.");
  }
  if (input.rawVideo.size > 200 * 1024 * 1024 || ![".mp4", ".mov", ".mkv", ".webm"].includes(extname(input.rawVideo.name).toLowerCase())) {
    throw new Error("Raw footage must be an MP4, MOV, MKV, or WebM file under 200 MB.");
  }
  if (activeProjects.has(input.projectId)) throw new Error("This CapCut project is already being edited.");
  activeProjects.add(input.projectId);
  try {
    const project = (await listProjects()).find((item) => item.id === input.projectId);
    if (!project) throw new Error("Selected CapCut project was not found. Refresh projects.");
    const draft = JSON.parse(await readFile(join(project.path, "draft_content.json"), "utf8")) as {
      tracks?: { segments?: unknown[] }[];
    };
    if (draft.tracks?.some((track) => track.segments?.length)) {
      throw new Error("Choose an empty CapCut project. Its timeline already contains clips; no changes were made.");
    }
    if (await capCutIsRunning()) throw new Error("Close CapCut before Run so it cannot overwrite the edited draft. Reopen it after Run completes.");
    const jobs = join(workspace, ".local-tools", "native-assets");
    const stagingRoot = join(workspace, ".local-tools", "staging");
    const backupRoot = join(workspace, ".local-tools", "backups");
    await Promise.all([mkdir(jobs, { recursive: true }), mkdir(stagingRoot, { recursive: true }), mkdir(backupRoot, { recursive: true })]);
    const job = await mkdtemp(join(jobs, "edit-"));
    const source = join(job, `raw${extname(input.rawVideo.name).toLowerCase()}`);
    await writeFile(source, Buffer.from(await input.rawVideo.arrayBuffer()));
    const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", source],
      { timeout: 30_000, maxBuffer: 1_000_000 });
    const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: {
      codec_type?: string; width?: number; height?: number;
    }[] };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration < 0.1 || !video?.width || !video?.height || video.width < 64 || video.height < 64) {
      throw new Error("The raw footage does not contain a readable video stream.");
    }
    const media = { path: source, width: video.width, height: video.height, durationUs: Math.round(duration * 1_000_000) };
    input.onLog?.("Preparing reference and raw footage for Codex analysis.");
    const { specPath, manifest, referencePath } = await createPlan(input, media, job);
    input.onLog?.("Codex finished its edit plan. Validating a temporary CapCut draft.");
    const staging = await mkdtemp(join(stagingRoot, "validate-"));
    await cp(project.path, staging, { recursive: true });
    await capcut(["compile", specPath, "--into", staging, "--active-timeline", "--check"]);
    await capcut(["compile", specPath, "--into", staging, "--active-timeline"]);
    const stagedLint = JSON.parse((await capcut(["lint", staging, "--json"])).stdout) as { ok: boolean };
    if (!stagedLint.ok) throw new Error("The staged CapCut edit did not pass draft validation. The project was not changed.");
    if (await capCutIsRunning()) throw new Error("CapCut reopened while planning. Close it and run again; the project was not changed.");
    const backup = join(backupRoot, `${project.id}-${randomUUID()}`);
    await cp(project.path, backup, { recursive: true });
    try {
      input.onLog?.("Staged draft passed validation. Writing the edit to the selected CapCut project.");
      await capcut(["compile", specPath, "--into", project.path, "--active-timeline"]);
      const liveLint = JSON.parse((await capcut(["lint", project.path, "--json"])).stdout) as { ok: boolean };
      if (!liveLint.ok) throw new Error("The updated CapCut draft failed validation.");
    } catch (error) {
      await cp(backup, project.path, { recursive: true, force: true });
      throw new Error(`The edit failed and the backup was restored. ${error instanceof Error ? error.message : String(error)}`);
    }
    input.onLog?.("CapCut draft passed lint. Open the project in CapCut to review its visual result.");
    return { projectName: project.name, applied: manifest.effects.map((effect) => effect.technique),
      toolsUsed: manifest.toolsUsed, notes: manifest.notes, backup, jobPath: job,
      referencePath, effects: manifest.effects, prompt: input.prompt, sourceName: input.rawVideo.name };
  } finally {
    activeProjects.delete(input.projectId);
  }
}
