"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

type Clip = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
type Project = { id: string; name: string; hasTimelineContent: boolean; clips: Clip[] };
type Recipe = { id: string; name: string; prompt: string; effects: string[]; createdAt: string };
type EditResult = { projectId: string; projectName: string; applied: string[]; toolsUsed: string[]; notes: string; backup: string };
type Job = { id: string; status: "running" | "complete" | "failed"; transcript: string[]; next: number; error?: string; result?: EditResult };

const field = "mt-2 w-full rounded-xl border border-white/15 bg-[#0b1220] px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300";
const button = "min-h-11 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";
const defaultPrompt = "Watch the reference video, identify its editing techniques and timing, and apply that edit to my raw footage.";

function transcriptLine(line: string) {
  try {
    const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string; command?: string; output?: string }; message?: string };
    const detail = event.item?.text ?? event.item?.command ?? event.item?.output ?? event.message;
    return detail ? `${event.type ?? "Codex"}${event.item?.type ? ` · ${event.item.type}` : ""}\n${detail}` : line;
  } catch {
    return line;
  }
}

export default function KeyframeHelper({ setupComplete }: { setupComplete: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [projectId, setProjectId] = useState("");
  const [clipId, setClipId] = useState("");
  const [rawVideo, setRawVideo] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [recipeId, setRecipeId] = useState("");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<Job["status"] | "idle">("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [rawTranscript, setRawTranscript] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const offset = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [projectsResponse, recipesResponse] = await Promise.all([
      fetch("/api/helper", { cache: "no-store" }),
      fetch("/api/edit-recipes", { cache: "no-store" }),
    ]);
    const projectData = await projectsResponse.json();
    const recipeData = await recipesResponse.json();
    if (!projectsResponse.ok || !recipesResponse.ok) throw new Error(projectData.error || recipeData.error || "Could not load projects.");
    const available = projectData.projects as Project[];
    setProjects(available);
    setProjectId((current) => available.some((project) => project.id === current) ? current : available.length === 1 ? available[0].id : "");
    setRecipes(recipeData.recipes as Recipe[]);
  }, []);

  const project = projects.find((item) => item.id === projectId);
  const selectedClip = project?.clips.find((item) => item.id === clipId) ?? (project?.clips.length === 1 ? project.clips[0] : undefined);
  const targetReady = project?.hasTimelineContent ? Boolean(selectedClip) : Boolean(project && rawVideo);

  useEffect(() => {
    void Promise.resolve().then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load projects."));
  }, [refresh]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const previous = window.sessionStorage.getItem("ai-editor-last-job");
      if (previous) { setJobId(previous); setStatus("running"); }
    });
  }, []);

  useEffect(() => {
    if (!jobId || status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/apply-native?id=${encodeURIComponent(jobId)}&since=${offset.current}`, { cache: "no-store" });
        const data = await response.json() as Job & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not read the Codex transcript.");
        if (cancelled) return;
        offset.current = data.next;
        if (data.transcript.length) setTranscript((current) => [...current, ...data.transcript]);
        if (data.status === "running") timer = setTimeout(poll, 1200);
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
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : "Could not read the edit progress.");
        }
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, status, refresh]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: "nearest" }); }, [transcript]);

  async function runEdit() {
    if (!projectId || !targetReady || (!reference && !recipeId)) return;
    setStarting(true);
    setError("");
    setResult(null);
    setSaved(false);
    setTranscript([]);
    setJobId("");
    offset.current = 0;
    const form = new FormData();
    form.set("projectId", projectId);
    if (project?.hasTimelineContent && selectedClip) form.set("clipId", selectedClip.id);
    else if (rawVideo) form.set("rawVideo", rawVideo);
    form.set("prompt", prompt.trim() || defaultPrompt);
    if (reference) form.set("reference", reference);
    if (recipeId) form.set("recipeId", recipeId);
    try {
      const response = await fetch("/api/apply-native", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the edit.");
      window.sessionStorage.setItem("ai-editor-last-job", data.id);
      setStatus("running");
      setJobId(data.id);
      setRecipeName(`${reference?.name.replace(/\.[^.]+$/, "") ?? recipes.find((item) => item.id === recipeId)?.name ?? "Reference"} edit`);
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Could not start the edit.");
    } finally {
      setStarting(false);
    }
  }

  async function saveRecipe() {
    if (!jobId || !result) return;
    try {
      const response = await fetch("/api/edit-recipes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name: recipeName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the recipe.");
      setSaved(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the recipe.");
    }
  }

  async function openProject() {
    try {
      const response = await fetch("/api/helper", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open-project", projectId: result?.projectId || projectId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open CapCut.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open CapCut.");
    }
  }

  const running = starting || status === "running";

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
          <label className="block text-sm text-slate-300">Reference video or image
            <input className={field} type="file" accept="video/*,image/*" disabled={running} onChange={(event) => { setReference(event.target.files?.[0] ?? null); setRecipeId(""); }} />
          </label>
          {reference && <p className="text-xs text-slate-400">Style source: {reference.name}</p>}
          {recipes.length > 0 && <label className="block text-sm text-slate-300">Or reuse a saved whole-edit recipe
            <select className={field} value={recipeId} disabled={running} onChange={(event) => { const id = event.target.value; setRecipeId(id); if (id) { setReference(null); setPrompt(recipes.find((item) => item.id === id)?.prompt ?? defaultPrompt); } }}>
              <option value="">Choose a recipe</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </label>}
          <label className="block text-sm text-slate-300">What should Codex copy or change?
            <textarea className={`${field} min-h-28 resize-y`} value={prompt} disabled={running} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} />
          </label>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold">Run the edit</h2><p className="mt-1 text-xs leading-5 text-slate-400">CapCut must be closed while Run writes the draft. Open it after the edit completes.</p></div>
          <button className={button} disabled={!setupComplete || running || !targetReady || (!reference && !recipeId)} onClick={() => void runEdit()}>{starting ? "Starting…" : running ? "Codex is editing…" : "Run"}</button>
        </div>
      </section>

      {(jobId || transcript.length > 0) && <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Codex conversation</h2><p className="mt-1 text-xs text-slate-400">{running ? "Live · analyzing and editing" : status === "complete" ? "Complete" : "Stopped"}</p></div><button className="text-xs font-medium text-emerald-300" onClick={() => setRawTranscript((value) => !value)}>{rawTranscript ? "Readable view" : "Raw transcript"}</button></div>
        <p className="mt-4 rounded-lg bg-[#0b1220] p-3 text-xs text-slate-300">You: {prompt}</p>
        <div className="mt-3 max-h-96 overflow-auto rounded-xl border border-white/10 bg-[#080c14] p-4" role="log" aria-live="polite"><pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-300">{transcript.map((line) => rawTranscript ? line : transcriptLine(line)).join("\n\n") || "Waiting for Codex…"}</pre><div ref={transcriptEnd} /></div>
      </section>}

      {result && <section className="rounded-2xl border border-emerald-300/25 bg-[#111b2a] p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Edit written to {result.projectName}</h2>
        <p className="mt-2 text-sm text-slate-300">Detected techniques: {result.applied.join(", ")}.</p>
        <p className="mt-2 text-xs text-slate-400">Tools used: {result.toolsUsed.join(", ") || "CapCut CLI"}. Open CapCut to review the visual result.</p>
        {result.notes && <p className="mt-2 text-xs text-slate-400">{result.notes}</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button className={button} onClick={() => void openProject()}>Open project in CapCut</button></div>
        <div className="mt-5 border-t border-white/10 pt-5"><h3 className="text-sm font-semibold">Save the whole edit as one recipe</h3><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input className={`${field} sm:mt-0`} value={recipeName} maxLength={80} onChange={(event) => setRecipeName(event.target.value)} aria-label="Recipe name" /><button className={button} disabled={saved || !recipeName.trim()} onClick={() => void saveRecipe()}>{saved ? "Saved" : "Save recipe"}</button></div></div>
        <p className="mt-4 break-all text-xs text-slate-500">Project backup: {result.backup}</p>
      </section>}
    </div>
  </main>;
}
