import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyNativeCapCut, approveNativeCandidate } from "./native-capcut";
import { snapshotEditSkill } from "./edit-skill-store";
import { acquireLock } from "../server/editing/lock";
import { openCandidateTestCopy } from "../server/capcut/test-copy";
import { suggestedReferencePrompt } from "./reference-prompts.mjs";
import { publicReferenceUrl } from "../server/security/public-reference.mjs";
import { editingFailureMessage } from "../server/editing/errors.mjs";
import { listProjects } from './keyframe-helper';
import { resolveEditSelection } from '../server/editing/project-scope.mjs';

const root = join(process.cwd(), ".local-tools");
const logs = join(root, "run-logs");
const recipesFile = join(root, "edit-recipes.json");
type EditResult = Awaited<ReturnType<typeof applyNativeCapCut>>;
type Status = "running" | "cancelling" | "cancelled" | "awaiting_approval" | "committing" | "complete" | "blocked" | "discarded" | "interrupted" | "failed";
type EditJob = { id: string; status: Status; canCancel?: boolean; controller?: AbortController; log?: (line: string) => void;
  checkpoint?: { jobPath: string; candidatePath: string; originalDigest: string; previewReady?: boolean };
  transcript: string[]; transcriptBase?: number; result?: EditResult; error?: string; createdAt: string; updatedAt: string; };
export type SavedRecipe = { id: string; name: string; prompt: string; referencePath: string; effects: string[]; sourceName: string; createdAt: string;
  planPath?: string; buildDirectory?: string; sourcePath?: string; workflowVersion?: number; model?: string; access?: string; };
const store = globalThis as typeof globalThis & { __aiEditorJobs?: Map<string, EditJob> };
const jobs = store.__aiEditorJobs ??= new Map<string, EditJob>();
function validId(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id)) throw new Error("Invalid job ID."); }
async function persist(job: EditJob) {
  await mkdir(logs, { recursive: true }); job.updatedAt = new Date().toISOString();
  const { controller: _controller, log: _log, ...saved } = job;
  void _controller; void _log;
  const path = join(logs, `${job.id}.status.json`), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(saved)); await rename(temporary, path);
}
async function loadJob(id: string) {
  validId(id); const active = jobs.get(id); if (active) return active;
  let job: EditJob;
  try { job = JSON.parse(await readFile(join(logs, `${id}.status.json`), "utf8")); } catch { throw new Error("Edit job not found."); }
  job.id = id; job.transcript ??= [];
  if (["running", "cancelling", "committing"].includes(job.status)) {
    job.status = "interrupted"; job.canCancel = false;
    job.error = "The app stopped during this job. Candidate files are retained. Review recovery status before starting again.";
    await persist(job);
  }
  jobs.set(id, job); return job;
}
export async function listEditRecipes(): Promise<SavedRecipe[]> {
  try { const data = JSON.parse(await readFile(recipesFile, "utf8")); return Array.isArray(data) ? data : []; } catch { return []; }
}
export async function startEditJob(input: { projectId: string; rawVideo?: File | null; clipId?: string; clipIds?: string[]; editScope?: string; reference?: File | null; referenceUrl?: string; recipeId?: string; prompt: string }) {
  if (input.recipeId) throw new Error('Reusable techniques are deferred. Start with a prompt and optional reference.');
  if (!input.projectId) throw new Error("Choose a project.");
  const selectedProject = (await listProjects()).find(project => project.id === input.projectId);
  if (!selectedProject) throw new Error('Selected project is unavailable. Refresh projects.');
  resolveEditSelection(selectedProject, input);
  const recipe = input.recipeId ? (await listEditRecipes()).find(item => item.id === input.recipeId) : undefined;
  if (input.recipeId && !recipe) throw new Error("Saved skill not found.");
  if ([Boolean(input.reference), Boolean(input.referenceUrl), Boolean(recipe)].filter(Boolean).length > 1) throw new Error("Choose one reference: file, public link or saved skill.");
  if (input.referenceUrl) publicReferenceUrl(input.referenceUrl);
  if (!input.reference && !input.referenceUrl && !recipe && !input.prompt.trim()) throw new Error("Enter editing instructions. A reference is optional.");
  const referenceKind = input.referenceUrl ? "link" : input.reference ? (/\.(mp4|mov|mkv|webm)$/i.test(input.reference.name) ? "video" : "image") : "";
  const release = await acquireLock(join(root, "locks", "editing.lock"));
  const id = randomUUID(), controller = new AbortController();
  const job: EditJob = { id, status: "running", transcript: [], controller, canCancel: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  jobs.set(id, job);
  try { await persist(job); } catch (error) { jobs.delete(id); await release(); throw error; }
  let writes = Promise.resolve();
  let diskLines = 0;
  const log = (line: string) => {
    const safe = line.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/(api[_-]?key|access_token|refresh_token|authorization_code)(["'\s:=]+)[^\s",}]+/gi, "$1$2[redacted]").slice(0, 12000);
    job.transcript.push(safe);
    if (job.transcript.length > 1500) { const trimmed = job.transcript.length - 1500; job.transcript.splice(0, trimmed); job.transcriptBase = (job.transcriptBase ?? 0) + trimmed; }
    if (diskLines++ < 1500) writes = writes.catch(() => undefined).then(() => appendFile(join(logs, `${id}.jsonl`), `${safe}\n`));
  };
  job.log = log;
  const deadline = setTimeout(() => controller.abort(new Error("The 30-minute job limit was reached. Candidate retained.")), 30 * 60 * 1000);
  void (async () => {
    try {
      job.result = await applyNativeCapCut({ ...input, prompt: input.prompt.trim() || recipe?.prompt || suggestedReferencePrompt(referenceKind),
        savedReferencePath: recipe?.referencePath, savedPlanPath: recipe?.planPath, savedBuildDirectory: recipe?.buildDirectory,
        savedSourcePath: recipe?.sourcePath, onLog: log, signal: controller.signal,
        onCheckpoint: async point => { job.checkpoint = point; await persist(job); } });
      job.status = job.result.verified ? "awaiting_approval" : "blocked";
      if (!job.result.verified) job.error = undefined;
    } catch (error) {
      job.status = controller.signal.aborted ? "cancelled" : "failed";
      job.error = editingFailureMessage(error); log(job.error);
    } finally { clearTimeout(deadline); job.canCancel = false; await writes.catch(() => undefined); await persist(job).finally(release); }
  })().catch(() => { job.canCancel = false; job.status = "failed"; job.error = "The job could not save its checkpoint. Candidate files are retained; check local storage before continuing."; });
  return id;
}
export async function getEditJob(id: string, since = 0) {
  const job = await loadJob(id);
  const base = job.transcriptBase ?? 0;
  const start = Number.isFinite(since) ? Math.max(0, Math.min(job.transcript.length, Math.floor(since) - base)) : 0;
  return { id, status: job.status, canCancel: Boolean(job.canCancel), transcript: job.transcript.slice(start), next: base + job.transcript.length, error: job.error,
    previewUrl: job.checkpoint?.previewReady ? `/api/artifact?id=${id}&kind=preview` : undefined,
    result: job.result && { projectId: job.result.projectId, projectName: job.result.projectName, applied: job.result.applied,
      toolsUsed: job.result.toolsUsed, notes: job.result.notes, backup: job.result.backup, model: job.result.model,
      access: job.result.access, iterations: job.result.iterations, verified: job.result.verified, quality: job.result.quality,
      scope: job.result.scope, selectedClipIds: job.result.selectedClipIds, projectPlan: job.result.projectPlan,
      previewLabel: job.result.projectPlan ? 'Last edited clip preview; inspect the complete project in CapCut.' : 'Edited clip preview',
      revision: job.result.candidateDigest, previewUrl: `/api/artifact?id=${id}&kind=preview`, evidencePath: job.result.evidencePath } };
}
export async function cancelEditJob(id: string) {
  const job = await loadJob(id);
  if (!["running", "cancelling"].includes(job.status)) return getEditJob(id);
  if (!job.controller || !job.canCancel) throw new Error("This job cannot be cancelled at its current stage.");
  job.status = "cancelling"; job.canCancel = false; job.controller.abort(new DOMException("Cancelled by user. Original unchanged.", "AbortError"));
  await persist(job); return getEditJob(id);
}
export async function decideEditJob(id: string, action: "approve" | "discard", revision: string) {
  if (!["approve", "discard"].includes(action)) throw new Error("Unknown review action.");
  const release = await acquireLock(join(root, "locks", "editing.lock"));
  try {
    const job = await loadJob(id);
    if (!["awaiting_approval", "blocked"].includes(job.status) || !job.result) throw new Error("This candidate is not awaiting review.");
    if (action === "discard") { job.status = "discarded"; await persist(job); return getEditJob(id); }
    if (job.status !== "awaiting_approval" || !job.result.verified) throw new Error("Native verification must pass before approval.");
    job.status = "committing"; await persist(job);
    try { job.result = await approveNativeCandidate(job.result, revision); job.status = "complete";
      try { await writeFile(join(logs, `${id}.result.json`), JSON.stringify(job.result)); }
      catch { job.error = "The edit was applied, but its reusable-recipe receipt could not be saved. Check local storage."; } }
    catch (error) { job.status = "blocked"; job.error = error instanceof Error ? error.message : "Commit failed."; }
    await persist(job); return getEditJob(id);
  } finally { await release(); }
}

export async function testEditJob(id: string, revision: string) {
  const release = await acquireLock(join(root, "locks", "editing.lock"));
  try {
    const job = await loadJob(id);
    if (!["awaiting_approval", "blocked"].includes(job.status) || !job.result) throw new Error("Build a candidate before opening a test copy.");
    if (job.result.candidateDigest !== revision) throw new Error("This candidate revision is stale.");
    return await openCandidateTestCopy(job.result.candidatePath, revision);
  } finally { await release(); }
}
export async function jobArtifact(id: string, kind: string) {
  const job = await loadJob(id);
  if (kind === "preview" && job.checkpoint?.previewReady) return { root: job.checkpoint.jobPath, path: join(job.checkpoint.jobPath, "preview.mp4") };
  if (!job.result || !["preview", "reference"].includes(kind)) throw new Error("Artifact unavailable.");
  return { root: job.result.jobPath, path: kind === "preview" ? join(job.result.jobPath, "preview.mp4") : job.result.referencePath };
}

export async function saveEditRecipe(jobId: string, name: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("Invalid job ID.");
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Enter a skill name up to 80 characters.");
  const job = jobs.get(jobId);
  let result = job?.status === "complete" ? job.result : undefined;
  if (!result && (await loadJob(jobId)).status === "complete") {
    try { result = JSON.parse(await readFile(join(logs, `${jobId}.result.json`), "utf8")) as EditResult; }
    catch { result = undefined; }
  }
  if (!result) throw new Error("Run and review the edit before saving its skill.");
  if (result.projectPlan) throw new Error('Multi-clip project recipes are not portable yet. Save a single-clip edit as a reusable skill.');
  const release = await acquireLock(join(root, "locks", "recipes.lock"));
  try {
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
  } finally { await release(); }
}
