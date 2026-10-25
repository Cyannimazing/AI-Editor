import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { runCancellableProcess } from "./cancellable-process";

const run = promisify(execFile);

export const editingAgent = {
  model: "gpt-6.1-sol",
  label: "GPT-6.1 Sol",
  access: "Full Access",
} as const;

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
  onLine: (line: string) => void, timeoutMs = 600_000, signal?: AbortSignal) {
  const nodeScript = extname(executable).toLowerCase() === ".js";
  const command = nodeScript ? process.execPath : executable;
  const prefix = nodeScript ? [executable] : [];
  const { stdout, stderr } = await run(command, [...prefix, "login", "status"], { cwd, timeout: 10000, signal });
  if (!/Logged in using ChatGPT/i.test(`${stdout}\n${stderr}`)) {
    throw new Error("Sign in to Codex CLI with ChatGPT. API-key billing is not used by this app.");
  }
  const [subcommand, ...options] = args;
  onLine(`Codex CLI: ${editingAgent.label} · high reasoning · ${editingAgent.access} · approvals disabled · network and local shell enabled.`);
  await runCancellableProcess(command, [...prefix, subcommand, "--model", editingAgent.model,
    "--dangerously-bypass-approvals-and-sandbox", "--config", "model_reasoning_effort=high",
    "--enable", "shell_tool", "--enable", "unified_exec", ...options],
  { cwd, stdin: prompt, signal, timeoutMs, onLine });
}
