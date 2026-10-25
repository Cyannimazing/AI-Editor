import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyNativeCapCut } from "./native-capcut";

const root = join(process.cwd(), ".local-tools");
const logs = join(root, "run-logs");
const recipesFile = join(root, "edit-recipes.json");

type EditResult = Awaited<ReturnType<typeof applyNativeCapCut>>;
type EditJob = {
  id: string;
  status: "running" | "complete" | "failed";
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
  rawVideo: File;
  reference?: File | null;
  recipeId?: string;
  prompt: string;
}) {
  if (!input.projectId || !(input.rawVideo instanceof File)) throw new Error("Choose a CapCut project and raw video.");
  const recipe = input.recipeId ? (await listEditRecipes()).find((item) => item.id === input.recipeId) : undefined;
  if (input.recipeId && !recipe) throw new Error("Saved recipe not found.");
  if (!input.reference && !recipe) throw new Error("Attach a reference video or choose a saved recipe.");
  const prompt = input.prompt.trim() || recipe?.prompt || "Copy the reference edit onto my raw video.";
  const id = randomUUID();
  const job: EditJob = { id, status: "running", transcript: [] };
  jobs.set(id, job);
  await mkdir(logs, { recursive: true });
  let pendingWrite = Promise.resolve();
  const log = (line: string) => {
    job.transcript.push(line);
    pendingWrite = pendingWrite.catch(() => undefined).then(() => appendFile(join(logs, `${id}.jsonl`), `${line}\n`, "utf8"));
  };
  log("Starting reference analysis and CapCut edit.");
  void (async () => {
    try {
      job.result = await applyNativeCapCut({
        projectId: input.projectId,
        rawVideo: input.rawVideo,
        reference: input.reference,
        savedReferencePath: recipe?.referencePath,
        prompt,
        onLog: log,
      });
      job.status = "complete";
      await writeFile(join(logs, `${id}.result.json`), JSON.stringify(job.result), "utf8");
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "The edit failed.";
      log(`ERROR: ${job.error}`);
    } finally {
      await pendingWrite.catch(() => undefined);
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
      throw new Error("Edit job not found. If the server restarted during Run, start it again.");
    }
  }
  const start = Math.max(0, Math.min(job.transcript.length, Math.floor(since)));
  return {
    id,
    status: job.status,
    transcript: job.transcript.slice(start),
    next: job.transcript.length,
    error: job.error,
    result: job.result && {
      projectName: job.result.projectName,
      applied: job.result.applied,
      toolsUsed: job.result.toolsUsed,
      notes: job.result.notes,
      backup: job.result.backup,
    },
  };
}

export async function saveEditRecipe(jobId: string, name: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("Invalid job ID.");
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Enter a recipe name up to 80 characters.");
  const job = jobs.get(jobId);
  let result = job?.status === "complete" ? job.result : undefined;
  if (!result) {
    try { result = JSON.parse(await readFile(join(logs, `${jobId}.result.json`), "utf8")) as EditResult; }
    catch { result = undefined; }
  }
  if (!result) throw new Error("Run and review the edit before saving its recipe.");
  const recipes = await listEditRecipes();
  if (recipes.some((item) => item.id === jobId)) throw new Error("This edit is already saved as a recipe.");
  const recipe: SavedRecipe = {
    id: jobId,
    name: cleanName,
    prompt: result.prompt,
    referencePath: result.referencePath,
    effects: result.applied,
    sourceName: result.sourceName,
    createdAt: new Date().toISOString(),
  };
  recipes.unshift(recipe);
  await mkdir(root, { recursive: true });
  const temporary = `${recipesFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(recipes, null, 2), "utf8");
  await rename(temporary, recipesFile);
  return recipe;
}
