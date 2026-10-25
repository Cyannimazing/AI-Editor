import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function codexExecutable() {
  const pnpmCodex = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    "pnpm", "global", "5", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (existsSync(pnpmCodex)) return pnpmCodex;
  const extensions = join(homedir(), ".vscode", "extensions");
  const candidates = (await readdir(extensions).catch(() => []))
    .filter((name) => name.startsWith("openai.chatgpt-"))
    .sort().reverse();
  if (!candidates.length) throw new Error("Codex CLI is not installed in VS Code.");
  return join(extensions, candidates[0], "bin", "windows-x86_64", "codex.exe");
}

export async function runCodexStream(executable: string, args: string[], cwd: string, prompt: string,
  onLine: (line: string) => void, timeoutMs = 600_000) {
  const nodeScript = extname(executable).toLowerCase() === ".js";
  const command = nodeScript ? process.execPath : executable;
  const prefix = nodeScript ? [executable] : [];
  const { stdout, stderr } = await run(command, [...prefix, "login", "status"], { cwd, timeout: 10000 });
  if (!/Logged in using ChatGPT/i.test(`${stdout}\n${stderr}`)) {
    throw new Error("Sign in to Codex CLI with ChatGPT. API-key billing is not used by this app.");
  }
  await new Promise<void>((resolve, reject) => {
    const [subcommand, ...options] = args;
    const child = spawn(command, [...prefix, subcommand, "--model", "gpt-6-sol", "--config",
      "model_reasoning_effort=high", ...options], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const buffers = { stdout: "", stderr: "" };
    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      buffers[stream] += chunk.toString("utf8");
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line);
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      for (const line of Object.values(buffers)) if (line.trim()) onLine(line);
      if (code === 0) resolve();
      else reject(new Error(`Codex CLI exited with code ${code ?? "unknown"}. See the transcript for details.`));
    });
    child.stdin.end(prompt);
  });
}
