import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable, codeModeHost } from "../platform/runtime.mjs";

type Result = { available: boolean; reason: string };
const store = globalThis as typeof globalThis & { __editorIsolation?: Promise<Result> };

/** Local MCP performs validated job-scoped edits; workers have no shell or desktop. */
export function isolationStatus(refresh = false): Promise<Result> {
  if (refresh) store.__editorIsolation = undefined;
  return store.__editorIsolation ??= (async () => {
    try {
      const executable = findExecutable("codex");
      if (!executable) return { available: false, reason: "Install Codex to use your local editing workspace." };
      if (!codeModeHost()) return { available: false, reason: 'Update the official Codex app/CLI to install its local tool host.' };
      const { stdout } = await promisify(execFile)(executable, ["features", "list"], { cwd: process.cwd(), timeout: 15000, windowsHide: true, maxBuffer: 40000 });
      for (const feature of ["shell_tool", "unified_exec", "hooks", "plugins", "computer_use", "browser_use"])
        if (!new RegExp(`^${feature}\\s`, "m").test(stdout)) return { available: false, reason: "Update Codex: this version does not support the controlled editing policy." };
      return { available: true, reason: "Codex uses job-bound local MCP tools. Only the lead can build the candidate; original projects, shell access and desktop control stay protected." };
    } catch {
      return { available: false, reason: "Codex could not start. Retry the account connection or update Codex." };
    }
  })();
}

export async function requireIsolation() {
  const state = await isolationStatus(true);
  if (!state.available) throw new Error(state.reason);
}
