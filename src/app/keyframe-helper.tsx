"use client";

import { apiFetch } from "@/lib/api-client";
import { updateReferencePrompt } from "@/lib/reference-prompts.mjs";
import { readableProgress } from "@/lib/edit-progress.mjs";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

type Clip = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
type Project = { id: string; name: string; hasTimelineContent: boolean; clips: Clip[] };
type Recipe = { id: string; name: string; prompt: string; effects: string[]; createdAt: string };
type EditResult = { projectId: string; projectName: string; applied: string[]; toolsUsed: string[]; notes: string; backup: string;
  model?: string; access?: string; iterations?: number; verified?: boolean; evidencePath?: string; revision: string; previewUrl?: string;
  quality?: { decision: string; summary: string; defects: { component: string; timeSeconds: number; expected: string; observed: string }[];
    techniques: { id: string; name: string; status: string; evidence: string[] }[]; unknowns: string[] } };
type Job = { id: string; status: "running" | "cancelling" | "cancelled" | "complete" | "failed" | "awaiting_approval" | "committing" | "blocked" | "discarded" | "interrupted"; canCancel: boolean; transcript: string[]; next: number; error?: string; result?: EditResult; previewUrl?: string };

const field = "mt-2 w-full rounded-xl border border-white/15 bg-[#0b1220] px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300";
const button = "min-h-11 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";

export default function KeyframeHelper({ setupComplete }: { setupComplete: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [projectId, setProjectId] = useState("");
  const [clipId, setClipId] = useState("");
  const [rawVideo, setRawVideo] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const referenceFile = useRef<HTMLInputElement>(null);
  const [recipeId, setRecipeId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<Job["status"] | "idle">("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [rawTranscript, setRawTranscript] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openedCopy, setOpenedCopy] = useState("");
  const [includeLocal, setIncludeLocal] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const offset = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const progress = readableProgress(transcript);

  const refresh = useCallback(async () => {
    const [projectsResponse, recipesResponse] = await Promise.all([
      apiFetch(`/api/helper${includeLocal ? "?includeLocal=1" : ""}`, { cache: "no-store" }),
      apiFetch("/api/edit-recipes", { cache: "no-store" }),
    ]);
    const projectData = await projectsResponse.json();
    const recipeData = await recipesResponse.json();
    if (!projectsResponse.ok || !recipesResponse.ok) throw new Error(projectData.error || recipeData.error || "Could not load projects.");
    const available = projectData.projects as Project[];
    setProjects(available);
    setProjectId((current) => available.some((project) => project.id === current) ? current : available.length === 1 ? available[0].id : "");
    setRecipes(recipeData.recipes as Recipe[]);
  }, [includeLocal]);

  const project = projects.find((item) => item.id === projectId);
  const selectedClip = project?.clips.find((item) => item.id === clipId) ?? (project?.clips.length === 1 ? project.clips[0] : undefined);
  const targetReady = project?.hasTimelineContent ? Boolean(selectedClip) : Boolean(project && rawVideo);

  useEffect(() => {
    void Promise.resolve().then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load projects."));
  }, [refresh]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const previous = window.sessionStorage.getItem("ai-editor-last-job");
      const skillName = window.sessionStorage.getItem("ai-editor-skill-name");
      if (skillName) setRecipeName(skillName);
      if (previous) { setJobId(previous); setStatus("running"); }
    });
  }, []);

  useEffect(() => {
    if (!jobId || !["running", "cancelling", "committing"].includes(status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await apiFetch(`/api/apply-native?id=${encodeURIComponent(jobId)}&since=${offset.current}`, { cache: "no-store" });
        const data = await response.json() as Job & { error?: string };
        if (!response.ok) {
          if (!cancelled) { setStatus("failed"); setCanCancel(false); setError(data.error || "Could not read the Codex transcript."); }
          return;
        }
        if (cancelled) return;
        offset.current = data.next;
        setCanCancel(data.canCancel);
        if (data.previewUrl) setPreviewUrl(data.previewUrl);
        if (data.transcript.length) setTranscript((current) => [...current, ...data.transcript]);
        if (["running", "cancelling", "committing"].includes(data.status)) timer = setTimeout(poll, 1200);
        else {
          setStatus(data.status);
          if (data.error) setError(data.error);
          if (data.result) {
            setResult(data.result);
            void refresh().catch(() => undefined);
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? `${cause.message} Reconnecting to the active run…` : "Reconnecting to the active run…");
          timer = setTimeout(poll, 2000);
        }
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, status, refresh]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: "nearest" }); }, [transcript]);

  async function runEdit() {
    if (!projectId || !targetReady || !prompt.trim()) return;
    setStarting(true);
    setCanCancel(false);
    setError("");
    setResult(null);
    setOpenedCopy("");
    setPreviewUrl("");
    setSaved(false);
    setTranscript([]);
    setJobId("");
    offset.current = 0;
    const form = new FormData();
    form.set("projectId", projectId);
    if (project?.hasTimelineContent && selectedClip) form.set("clipId", selectedClip.id);
    else if (rawVideo) form.set("rawVideo", rawVideo);
    form.set("prompt", prompt.trim());
    if (reference) form.set("reference", reference);
    if (referenceUrl.trim()) form.set("referenceUrl", referenceUrl.trim());
    if (recipeId) form.set("recipeId", recipeId);
    try {
      const response = await apiFetch("/api/apply-native", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the edit.");
      window.sessionStorage.setItem("ai-editor-last-job", data.id);
      setStatus("running");
      setCanCancel(true);
      setJobId(data.id);
      if (!recipeName.trim()) {
        const name = `${reference?.name.replace(/\.[^.]+$/, "") ?? recipes.find((item) => item.id === recipeId)?.name ?? "Reference"} edit`;
        setRecipeName(name);
        window.sessionStorage.setItem("ai-editor-skill-name", name);
      }
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Could not start the edit.");
    } finally {
      setStarting(false);
    }
  }

  async function cancelRun() {
    if (!jobId || !canCancel) return;
    setCanCancel(false);
    setError("");
    try {
      const response = await apiFetch(`/api/apply-native?id=${encodeURIComponent(jobId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not cancel the run.");
      setStatus("cancelling");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the run.");
    }
  }

  async function saveRecipe() {
    if (!jobId || !result || status !== "complete") return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/edit-recipes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name: recipeName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the skill.");
      setSaved(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the skill.");
    } finally {
      setSaving(false);
    }
  }

  async function decide(action: "approve" | "discard") {
    if (!result || !jobId) return;
    setStarting(true); setError("");
    try {
      const response = await apiFetch("/api/apply-native", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId, action, revision: result.revision }) });
      const data = await response.json() as Job;
      if (!response.ok) throw new Error(data.error || "Could not complete this action.");
      setStatus(data.status); setResult(data.result ?? null); setError(data.error ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review action failed."); }
    finally { setStarting(false); }
  }

  async function openProject() {
    try {
      const response = await apiFetch("/api/helper", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open-project", projectId: result?.projectId || projectId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open CapCut.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open CapCut.");
    }
  }

  async function openTestCopy() {
    if (!result || !jobId || opening) return;
    setOpening(true); setError("");
    try {
      const response = await apiFetch("/api/apply-native", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId, action: "open-test-copy", revision: result.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open the test copy.");
      setOpenedCopy(data.projectName);
      void refresh().catch(() => undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open the test copy."); }
    finally { setOpening(false); }
  }

  async function createProject() {
    setStarting(true); setError("");
    try {
      const response = await apiFetch("/api/helper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-local-project" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not create a test project.");
      setIncludeLocal(true); await refresh(); setProjectId(data.projectId); setClipId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a test project."); }
    finally { setStarting(false); }
  }

  const running = starting || status === "running" || status === "cancelling" || status === "committing";
  const skillSaved = saved || recipes.some((recipe) => recipe.id === jobId);

  function selectSkill(recipe: Recipe) {
    setRecipeId(recipe.id);
    setReference(null);
    setReferenceUrl("");
    if (referenceFile.current) referenceFile.current.value = "";
    setPrompt(recipe.prompt);
  }

  function chooseReference(file: File | null) {
    setReference(file); setRecipeId("");
    if (file) setReferenceUrl("");
    setPrompt(current => updateReferencePrompt(current, file ? (file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm)$/i.test(file.name) ? "video" : "image") : ""));
  }

  function changeReferenceUrl(value: string) {
    setReferenceUrl(value); setReference(null); setRecipeId("");
    if (referenceFile.current) referenceFile.current.value = "";
    setPrompt(current => updateReferencePrompt(current, value.trim() ? "link" : ""));
  }

  return <main className="min-h-screen bg-[#080c14] px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b border-white/10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">CapCut automation</p>
        <h1 className="mt-2 text-3xl font-semibold">Edit from a reference</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose a CapCut project and a reference. Edit one existing timeline clip, or add raw footage to an empty project.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-5 rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">01 · Target</p><h2 className="mt-2 text-xl font-semibold">Video to edit</h2></div>
          <label className="block text-sm text-slate-300">CapCut project
            <select className={field} value={projectId} disabled={running} onChange={(event) => { setProjectId(event.target.value); setClipId(""); }}>
              <option value="">Select project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.hasTimelineContent ? `${project.clips.length} video clips` : "Empty timeline"}</option>)}
            </select>
          </label>
          <button className="text-xs font-medium text-emerald-300 hover:text-emerald-200" disabled={running} onClick={() => void refresh().catch((cause) => setError(String(cause)))}>Refresh projects</button>
          <button className="ml-4 min-h-11 text-xs font-medium text-emerald-300" disabled={running} onClick={() => void createProject()}>Create disposable test project</button>
          <label className="flex min-h-11 items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={includeLocal} disabled={running} onChange={event => setIncludeLocal(event.target.checked)} />Show AI-Editor test fixtures</label>
          <p className="text-xs leading-5 text-slate-400">Projects come from your CapCut library. Edits are built as separate candidates.</p>
          {projects.length === 0 && <p className="text-sm text-amber-200">No local projects found. Save a project in CapCut, then refresh.</p>}
          {project?.hasTimelineContent ? <div>
            <h3 id="clip-picker-label" className="text-sm font-medium text-slate-300">Choose the timeline clip to edit</h3>
            <div className="mt-3 max-h-80 space-y-2 overflow-auto" role="radiogroup" aria-labelledby="clip-picker-label">
              {project.clips.map((clip) => <label key={clip.id} className={`flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left focus-within:outline-2 focus-within:outline-emerald-300 ${selectedClip?.id === clip.id ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-[#0b1220] hover:border-white/30"}`}>
                <input type="radio" name="target-clip" value={clip.id} checked={selectedClip?.id === clip.id} disabled={running} onChange={() => setClipId(clip.id)} className="sr-only" />
                <Image unoptimized src={`/api/clip-thumbnail?projectId=${encodeURIComponent(project.id)}&clipId=${encodeURIComponent(clip.id)}`} alt="" width={80} height={60} className="h-16 w-20 shrink-0 rounded-lg bg-black object-cover" />
                <span className="min-w-0"><span className="block break-words text-sm font-medium">{clip.name}</span><span className="mt-1 block text-xs text-slate-400">{clip.trackName} · {(clip.startUs / 1_000_000).toFixed(2)}–{((clip.startUs + clip.durationUs) / 1_000_000).toFixed(2)}s</span></span>
              </label>)}
            </div>
            {project.clips.length ? <p className="mt-3 text-xs leading-5 text-slate-400">Run edits only the selected clip. Other clips and audio stay in place.</p> : <p className="mt-3 text-sm text-amber-200">This timeline has content but no editable video clips.</p>}
          </div> : <label className="block text-sm text-slate-300">Raw footage to add and edit
            <input className={field} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" disabled={running} onChange={(event) => setRawVideo(event.target.files?.[0] ?? null)} />
          </label>}
          {!project?.hasTimelineContent && rawVideo && <p className="text-xs text-slate-400">{rawVideo.name} · {(rawVideo.size / 1024 / 1024).toFixed(1)} MB</p>}
        </section>

        <section className="space-y-5 rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">02 · Style</p><h2 className="mt-2 text-xl font-semibold">Reference edit</h2></div>
          <label className="block text-sm text-slate-300">Reference video or image (optional)
            <input ref={referenceFile} className={field} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,image/png,image/jpeg,image/webp" disabled={running} onChange={(event) => chooseReference(event.target.files?.[0] ?? null)} />
          </label>
          {reference && <div className="flex items-center gap-3 text-xs text-slate-400"><span>Style source: {reference.name}</span><button className="min-h-11 text-emerald-300" disabled={running} onClick={() => { chooseReference(null); if (referenceFile.current) referenceFile.current.value = ""; }}>Remove reference</button></div>}
          <label className="block text-sm text-slate-300">Or public reference link (optional)
            <input className={field} type="url" value={referenceUrl} maxLength={2048} placeholder="https://…" disabled={running} onChange={event => changeReferenceUrl(event.target.value)} />
          </label>
          <p className="text-xs leading-5 text-slate-400">Public images, videos and pages that expose downloadable media are supported. Login-only pages and embedded players may require a file. You can also leave both references empty and just write instructions.</p>
          {recipes.length > 0 && <label className="block text-sm text-slate-300">Or reuse a saved skill
            <select className={field} value={recipeId} disabled={running} onChange={(event) => { const id = event.target.value; setRecipeId(id); const recipe = recipes.find((item) => item.id === id); if (recipe) selectSkill(recipe); }}>
              <option value="">Choose a skill</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </label>}
          <label className="block text-sm text-slate-300">What should Codex copy or change?
            <textarea className={`${field} min-h-28 resize-y`} value={prompt} placeholder="Describe the changes you want. Include exact words for any titles or captions." disabled={running} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} />
          </label>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold">Run the edit</h2><p className="mt-1 text-xs font-medium text-emerald-300">GPT-6.1 Sol · Restricted candidate workspace</p><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">The editor builds a separate candidate, then reviewers check the evidence. Watch the design preview here. Applying changes requires native CapCut verification and your approval.</p>{status === "cancelled" && <p className="mt-2 text-sm text-amber-200" role="status">Run cancelled. No edit was written to CapCut.</p>}</div>
          <div className="flex flex-wrap gap-3"><button className={button} disabled={!setupComplete || running || !targetReady || !prompt.trim()} onClick={() => void runEdit()}>{starting ? "Starting…" : status === "cancelling" ? "Cancelling…" : running ? "Codex is editing…" : "Run"}</button>
          {jobId && running && <button className="min-h-11 rounded-xl border border-amber-300/40 px-5 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canCancel || status === "cancelling"} onClick={() => void cancelRun()}>{status === "cancelling" ? "Stopping tools…" : canCancel ? "Cancel run" : "Finishing write…"}</button>}</div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-emerald-300/25 bg-[#111b2a] p-5 sm:p-6" aria-labelledby="save-skill-title">
          <h2 id="save-skill-title" className="text-lg font-semibold">Save reusable skill</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Save the edit, prompts, technique measurements, build sources and native comparison history under your own name for new footage.</p>
          <label className="mt-4 block text-sm text-slate-300">Skill name
            <input className={field} value={recipeName} maxLength={80} placeholder="Name this editing skill" disabled={saving || skillSaved}
              onChange={(event) => { setRecipeName(event.target.value); window.sessionStorage.setItem("ai-editor-skill-name", event.target.value); }} />
          </label>
          <button className={`${button} mt-4`} disabled={running || saving || status !== "complete" || !result || !recipeName.trim() || skillSaved} onClick={() => void saveRecipe()}>{saving ? "Saving…" : skillSaved ? "Skill saved" : "Save skill"}</button>
          <p className="mt-3 text-xs leading-5 text-slate-400" role="status">{skillSaved ? "Saved in your skills library." : status === "complete" ? "The completed edit is ready to save. Saving is optional." : "Name it now. Save skill becomes available after Run completes successfully."}</p>
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6" aria-labelledby="saved-skills-title">
          <div className="flex items-center justify-between gap-3"><h2 id="saved-skills-title" className="text-lg font-semibold">Saved skills</h2><span className="text-xs text-slate-400">{recipes.length}</span></div>
          {recipes.length === 0 ? <p className="mt-4 text-sm leading-6 text-slate-400">No skills saved yet. Run an edit, name it, and click Save skill.</p> : <div className="mt-4 max-h-80 space-y-3 overflow-auto">
            {recipes.map((recipe) => <article key={recipe.id} className={`rounded-xl border p-4 ${recipeId === recipe.id ? "border-emerald-300 bg-emerald-300/5" : "border-white/10 bg-[#0b1220]"}`}>
              <h3 className="break-words text-sm font-semibold">{recipe.name}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-400">{recipe.effects.length} techniques · {recipe.effects.join(", ")}</p>
              <button className={`${button} mt-3`} disabled={running} onClick={() => selectSkill(recipe)}>{recipeId === recipe.id ? "Selected for reuse" : "Use skill"}</button>
            </article>)}
          </div>}
        </section>
      </div>

      {previewUrl && !result && <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Early design preview</h2>
        <p className="mt-2 text-sm text-slate-400">Review is still in progress. CapCut-specific effects may differ.</p>
        <video controls preload="metadata" src={previewUrl} className="mt-4 max-h-96 w-full rounded-xl bg-black" />
      </section>}
      {(jobId || transcript.length > 0) && <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Editing progress</h2><p className="mt-1 text-xs text-slate-400">{status === "cancelling" ? "Stopping tools…" : running ? "Live · analyzing and editing" : status === "complete" ? "Complete" : status === "cancelled" ? "Cancelled" : status === "failed" ? "Could not finish" : status === "blocked" ? "Needs review" : status === "awaiting_approval" ? "Ready for your approval" : "Stopped"}</p></div><button className="min-h-11 px-2 text-xs font-medium text-emerald-300" aria-pressed={rawTranscript} onClick={() => setRawTranscript((value) => !value)}>{rawTranscript ? "Show readable progress" : "Show diagnostic details"}</button></div>
        <p className="mt-4 rounded-lg bg-[#0b1220] p-3 text-xs text-slate-300">You: {prompt}</p>
        <div className="mt-3 max-h-96 space-y-3 overflow-auto rounded-xl border border-white/10 bg-[#080c14] p-4" role="log" aria-live="polite" aria-label="Editing progress">
          {rawTranscript ? <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-300">{transcript.join("\n\n") || "Waiting for Codex…"}</pre>
            : progress.length ? progress.map((entry, index) => <p key={index} className={`whitespace-pre-wrap break-words text-sm leading-6 ${entry.kind === 'error' ? 'text-red-300' : entry.kind === 'notice' ? 'text-amber-200' : 'text-slate-300'}`}>{entry.text}</p>)
              : <p className="text-sm text-slate-300">Waiting for the editing AI…</p>}
          <div ref={transcriptEnd} />
        </div>
      </section>}

      {result && <section className="rounded-2xl border border-emerald-300/25 bg-[#111b2a] p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{status === "complete" ? "Edit applied to" : "Candidate for"} {result.projectName}</h2>
        <p className="mt-2 text-sm text-slate-300">Requested techniques: {result.applied.join(", ")}.</p>
        {result.verified && <p className="mt-2 text-sm text-emerald-300">Native comparison passed after {result.iterations} {result.iterations === 1 ? "iteration" : "iterations"} · {result.model} · {result.access}</p>}
        <p className="mt-2 text-xs text-slate-400">Tools used: {result.toolsUsed.join(", ") || "CapCut CLI"}. {result.verified ? "Native verification passed." : "Quality verification is incomplete. The candidate is available for inspection; your original has not been changed."}</p>
        {result.quality && <div className="mt-4 rounded-xl border border-amber-300/20 p-4">
          <p className="text-sm font-semibold">{result.quality.summary}</p>
          <ul className="mt-3 space-y-2 text-sm">{result.quality.techniques.map(technique => <li key={technique.id}>
            <span className="font-medium">{technique.name}</span>: {technique.status === 'matched' ? 'Preview comparison passed' : technique.status === 'defect' ? 'Needs correction' : 'Evidence still needed'}
          </li>)}</ul>
          {result.quality.defects.map((defect, index) => <p key={index} className="mt-2 text-xs text-amber-200">{defect.timeSeconds.toFixed(2)}s · {defect.observed} Expected: {defect.expected}</p>)}
          {result.quality.unknowns.length > 0 && <details className="mt-3 text-xs text-slate-300"><summary>Unresolved verification</summary><ul className="mt-2 space-y-2">{result.quality.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details>}
        </div>}
        {result.notes && <p className="mt-2 text-xs text-slate-400">{result.notes}</p>}
        {result.previewUrl && <div className="mt-5"><p className="mb-2 text-sm text-slate-300">Design preview: CapCut-specific effects may differ</p><video controls preload="metadata" src={result.previewUrl} className="max-h-96 w-full rounded-xl bg-black" /></div>}
        <div className="mt-5 flex flex-wrap gap-3">
          {status === "complete" && <button className={button} onClick={() => void openProject()}>Open project in CapCut</button>}
          {["awaiting_approval", "blocked"].includes(status) && <>
            <button className={button} disabled={opening} onClick={() => void openTestCopy()}>{opening ? "Opening CapCut…" : "Open editable test copy in CapCut"}</button>
            <button className={button} disabled={!result.verified || status !== "awaiting_approval"} onClick={() => void decide("approve")}>Approve and apply</button>
            <button className="min-h-11 rounded-xl border border-white/20 px-5 py-3 text-sm" onClick={() => void decide("discard")}>Discard candidate</button>
          </>}
          {status === "discarded" && <p role="status">Candidate discarded. Original unchanged.</p>}
        </div>
        {openedCopy && <p role="status" className="mt-4 text-sm text-emerald-200">Test copy registered as “{openedCopy}”. Select it in CapCut’s project list if CapCut opens its home screen. The original is unchanged.</p>}
        {result.backup && <p className="mt-4 break-all text-xs text-slate-500">Project backup: {result.backup}</p>}
        {result.evidencePath && <p className="mt-2 break-all text-xs text-slate-500">Review evidence: {result.evidencePath}</p>}
      </section>}
    </div>
  </main>;
}
