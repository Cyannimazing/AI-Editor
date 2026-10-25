import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyNativeCapCut } from "./native-capcut";
import { snapshotEditSkill } from "./edit-skill-store";

const root = join(process.cwd(), ".local-tools");
const logs = join(root, "run-logs");
const recipesFile = join(root, "edit-recipes.json");

type EditResult = Awaited<ReturnType<typeof applyNativeCapCut>>;
type EditJob = {
  id: string;
  status: "running" | "cancelling" | "cancelled" | "complete" | "failed";
  canCancel?: boolean;
  controller?: AbortController;
  log?: (line: string) => void;
  transcript: string[];
  result?: EditResult;
  error?: string;
};
export type SavedRecipe = {
  id: string;
  name: string;
  prompt: string;
  referencePath: string;
  effects: string[];
  sourceName: string;
  createdAt: string;
  planPath?: string;
  buildDirectory?: string;
  sourcePath?: string;
  workflowVersion?: number;
  model?: string;
  access?: string;
};

const store = globalThis as typeof globalThis & { __aiEditorJobs?: Map<string, EditJob> };
const jobs = store.__aiEditorJobs ??= new Map<string, EditJob>();

export async function listEditRecipes(): Promise<SavedRecipe[]> {
  try {
    const data = JSON.parse(await readFile(recipesFile, "utf8")) as unknown;
    return Array.isArray(data) ? data as SavedRecipe[] : [];
  } catch {
    return [];
  }
}

export async function startEditJob(input: {
  projectId: string;
  rawVideo?: File | null;
  clipId?: string;
  reference?: File | null;
  recipeId?: string;
  prompt: string;
}) {
  if (!input.projectId || (!input.clipId && !(input.rawVideo instanceof File))) throw new Error("Choose a project and a timeline clip or raw video.");
  const recipe = input.recipeId ? (await listEditRecipes()).find((item) => item.id === input.recipeId) : undefined;
  if (input.recipeId && !recipe) throw new Error("Saved skill not found.");
  if (!input.reference && !recipe) throw new Error("Attach a reference video or choose a saved skill.");
  const prompt = input.prompt.trim() || recipe?.prompt || "Copy the reference edit onto my raw video.";
  const id = randomUUID();
  const controller = new AbortController();
  const job: EditJob = { id, status: "running", transcript: [], controller, canCancel: true };
  jobs.set(id, job);
  await mkdir(logs, { recursive: true });
  let pendingWrite = Promise.resolve();
  const log = (line: string) => {
    job.transcript.push(line);
    pendingWrite = pendingWrite.catch(() => undefined).then(() => appendFile(join(logs, `${id}.jsonl`), `${line}\n`, "utf8"));
  };
  job.log = log;
  log("Starting reference analysis and CapCut edit.");
  void (async () => {
    try {
      job.result = await applyNativeCapCut({
        projectId: input.projectId,
        rawVideo: input.rawVideo,
        clipId: input.clipId,
        reference: input.reference,
        savedReferencePath: recipe?.referencePath,
        savedPlanPath: recipe?.planPath,
        savedBuildDirectory: recipe?.buildDirectory,
        savedSourcePath: recipe?.sourcePath,
        prompt,
        onLog: log,
        signal: controller.signal,
        onCommit: () => { job.canCancel = false; log("Finishing the project write. Cancellation is disabled until this short write completes."); },
      });
      job.status = "complete";
      await writeFile(join(logs, `${id}.result.json`), JSON.stringify(job.result), "utf8");
    } catch (error) {
      if (controller.signal.aborted) {
        job.status = "cancelled";
        log("Run cancelled. No edit was written to the CapCut project.");
      } else {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "The edit failed.";
        log(`ERROR: ${job.error}`);
      }
    } finally {
      job.canCancel = false;
      await pendingWrite.catch(() => undefined);
      await writeFile(join(logs, `${id}.status.json`), JSON.stringify({ status: job.status, error: job.error })).catch(() => undefined);
    }
  })();
  return id;
}

export async function getEditJob(id: string, since = 0) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid job ID.");
  let job = jobs.get(id);
  if (!job) {
    try {
      const result = JSON.parse(await readFile(join(logs, `${id}.result.json`), "utf8")) as EditResult;
      const transcript = (await readFile(join(logs, `${id}.jsonl`), "utf8")).split(/\r?\n/).filter(Boolean);
      job = { id, status: "complete", result, transcript };
    } catch {
      try {
        const saved = JSON.parse(await readFile(join(logs, `${id}.status.json`), "utf8")) as { status: EditJob["status"]; error?: string };
        const transcript = (await readFile(join(logs, `${id}.jsonl`), "utf8")).split(/\r?\n/).filter(Boolean);
        job = { id, status: saved.status, error: saved.error, transcript };
      } catch {
        throw new Error("Edit job not found. If the server restarted during Run, start it again.");
      }
    }
  }
  const start = Math.max(0, Math.min(job.transcript.length, Math.floor(since)));
  return {
    id,
    status: job.status,
    canCancel: Boolean(job.canCancel),
    transcript: job.transcript.slice(start),
    next: job.transcript.length,
    error: job.error,
    result: job.result && {
      projectId: job.result.projectId,
      projectName: job.result.projectName,
      applied: job.result.applied,
      toolsUsed: job.result.toolsUsed,
      notes: job.result.notes,
      backup: job.result.backup,
      model: job.result.model,
      access: job.result.access,
      iterations: job.result.iterations,
      verified: job.result.verified,
      evidencePath: job.result.evidencePath,
    },
  };
}

export async function cancelEditJob(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid job ID.");
  const job = jobs.get(id);
  if (!job || !["running", "cancelling"].includes(job.status)) return getEditJob(id);
  if (job.status === "cancelling") return getEditJob(id);
  if (!job.canCancel || !job.controller) throw new Error("The final project write has started and will finish safely. This run can no longer be cancelled.");
  job.status = "cancelling";
  job.canCancel = false;
  job.log?.("Cancellation requested. Stopping the active tools…");
  job.controller.abort(new DOMException("Run cancelled by user.", "AbortError"));
  return getEditJob(id);
}

export async function saveEditRecipe(jobId: string, name: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("Invalid job ID.");
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Enter a skill name up to 80 characters.");
  const job = jobs.get(jobId);
  let result = job?.status === "complete" ? job.result : undefined;
  if (!result) {
    try { result = JSON.parse(await readFile(join(logs, `${jobId}.result.json`), "utf8")) as EditResult; }
    catch { result = undefined; }
  }
  if (!result) throw new Error("Run and review the edit before saving its skill.");
  const recipes = await listEditRecipes();
  if (recipes.some((item) => item.id === jobId)) throw new Error("This edit is already saved as a skill.");
  const recipe: SavedRecipe = await snapshotEditSkill({
    id: jobId,
    name: cleanName,
    prompt: result.prompt,
    referencePath: result.referencePath,
    effects: result.applied,
    sourceName: result.sourceName,
    jobPath: result.jobPath,
  });
  recipes.unshift(recipe);
  await mkdir(root, { recursive: true });
  const temporary = `${recipesFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(recipes, null, 2), "utf8");
  await rename(temporary, recipesFile);
  return recipe;
}
