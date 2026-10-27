import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { promisify } from "node:util";

type Knowledge = { version: number; inspectedAt: string; packages: { name: string; version: string }[];
  capcut: { commands: { commands?: { name: string; summary: string; usage: string }[] }; keyframes: string[]; easing: string[]; blendModes: string[]; catalogs: Record<string, unknown[]> };
  ffmpeg: { found: boolean; verified: boolean; filters: string[] }; ffprobe: { verified: boolean }; codex: { verified: boolean };
  optionalRuntimes: Record<string, boolean>; applicationAdapter: { planVersion: number; executable: string[]; gaps: string[]; rule: string } };
const store = globalThis as typeof globalThis & { __editorToolKnowledge?: { fingerprint: string; value: Promise<Knowledge> } };

export async function toolKnowledge(refresh = false): Promise<Knowledge> {
  const root = process.cwd();
  const manifests = await Promise.all([
    readFile(join(root, "toolchain", "pnpm-lock.yaml")), readFile(join(root, "toolchain", "package.json")),
    readFile(join(root, "scripts", "inspect-editing-tools.mjs")), readFile(join(root, "ai", "context-index.json")),
  ]);
  const fingerprint = createHash("sha256").update(Buffer.concat(manifests)).digest("hex");
  if (!refresh && store.__editorToolKnowledge?.fingerprint === fingerprint) return store.__editorToolKnowledge.value;
  const value = (async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [join(root, "scripts", "inspect-editing-tools.mjs")],
      { cwd: root, timeout: 25000, windowsHide: true, maxBuffer: 2_000_000 });
    const result = JSON.parse(stdout) as Knowledge;
    if (result.version !== 1 || !result.capcut?.keyframes?.length || !result.packages?.length) throw new Error("The installed editing tool catalog could not be validated.");
    const folder = join(root, ".local-tools", "tool-knowledge"); await mkdir(folder, { recursive: true });
    const temporary = join(folder, `inventory-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(result, null, 2));
    await rename(temporary, join(folder, "inventory.json"));
    return result;
  })();
  store.__editorToolKnowledge = { fingerprint, value };
  try { return await value; } catch (error) { if (store.__editorToolKnowledge?.value === value) store.__editorToolKnowledge = undefined; throw error; }
}

export function toolKnowledgeSummary(knowledge: Knowledge, includeCommands = false) {
  return JSON.stringify({ inspectedAt: knowledge.inspectedAt, packages: knowledge.packages,
    nativeKeyframes: knowledge.capcut.keyframes, easing: knowledge.capcut.easing, blendModes: knowledge.capcut.blendModes,
    catalogCounts: Object.fromEntries(Object.entries(knowledge.capcut.catalogs).map(([kind, entries]) => [kind, entries.length])),
    ffmpeg: { executableVerified: knowledge.ffmpeg.verified, filterCount: knowledge.ffmpeg.filters.length },
    optionalRuntimes: knowledge.optionalRuntimes, applicationAdapter: knowledge.applicationAdapter,
    ...(includeCommands ? { commands: knowledge.capcut.commands.commands?.map(({ name, summary, usage }) => ({ name, summary, usage })) } : {}) });
}
