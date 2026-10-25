import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type SetupState = {
  stage: string;
  progress: number;
  detail: string;
  error: string | null;
  updatedAt?: string;
};

const root = process.cwd();
const statePath = join(root, ".local-tools", "setup-state.json");
const ffmpegPath = join(root, ".local-tools", "bin", "ffmpeg.exe");
const ffprobePath = join(root, ".local-tools", "bin", "ffprobe.exe");
const toolchainPath = join(root, "toolchain", "node_modules");
const processStore = globalThis as typeof globalThis & {
  __aiVideoEditorSetupProcess?: ChildProcess;
};

async function readState(): Promise<SetupState> {
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8")) as SetupState;
    if (saved.stage === "ready" && (
      !existsSync(ffmpegPath) || !existsSync(ffprobePath) ||
      !existsSync(join(toolchainPath, "remotion", "package.json")) ||
      !existsSync(join(toolchainPath, "hyperframes", "package.json"))
    )) {
      return { stage: "idle", progress: 0, detail: "Video tools need setup", error: null };
    }
    return saved;
  } catch {
    return { stage: "idle", progress: 0, detail: "Video tools need setup", error: null };
  }
}

export async function GET() {
  const state = await readState();
  return Response.json({
    ...state,
    tools: {
      ffmpeg: existsSync(ffmpegPath) && existsSync(ffprobePath),
      remotion: existsSync(join(toolchainPath, "remotion", "package.json")),
      hyperframes: existsSync(join(toolchainPath, "hyperframes", "package.json")),
      videoUse: existsSync(join(homedir(), ".codex", "skills", "video-use", "SKILL.md")),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      (origin && new URL(origin).host !== url.host)) {
    return Response.json({ error: "Setup is available only from this local app." }, { status: 403 });
  }

  const current = await readState();
  if (current.stage === "ready") return Response.json({ started: false, state: current });
  const active = processStore.__aiVideoEditorSetupProcess;
  if (active && active.exitCode === null) return Response.json({ started: false, state: current });

  await mkdir(join(root, ".local-tools"), { recursive: true });
  await writeFile(statePath, JSON.stringify({
    stage: "starting", progress: 0, detail: "Starting local setup", error: null,
    updatedAt: new Date().toISOString(),
  }));
  const child = spawn(process.execPath, [join(root, "scripts", "bootstrap-tools.mjs")], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  processStore.__aiVideoEditorSetupProcess = child;
  child.once("exit", () => {
    if (processStore.__aiVideoEditorSetupProcess === child) processStore.__aiVideoEditorSetupProcess = undefined;
  });
  return Response.json({ started: true }, { status: 202 });
}
