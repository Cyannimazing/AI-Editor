"use client";

import { apiFetch } from "@/lib/api-client";
import { updateReferencePrompt } from "@/lib/reference-prompts.mjs";
import { readableProgress } from "@/lib/edit-progress.mjs";
import { editorPolicy } from "@/lib/editor-policy.mjs";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipSelection } from './clip-selection';

type Clip = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
type Project = { id: string; name: string; kind?: 'project' | 'temporary-review' | 'test-project'; hasTimelineContent: boolean; clips: Clip[] };
type Discovery = { rootStatus: 'available' | 'missing' | 'unreadable'; capcutProjectsFound: number; hiddenReviewCopies: number;
  unreadableProjects: { id: string; name: string; message: string }[] };
type EditResult = { projectId: string; projectName: string; applied: string[]; toolsUsed: string[]; notes: string; backup: string;
  scope?: string; selectedClipIds?: string[]; previewLabel?: string; projectPlan?: { summary: string; clips: { clipId: string; action: string; instruction: string; reason: string }[]; unsupported: string[] };
  model?: string; access?: string; iterations?: number; verified?: boolean; evidencePath?: string; revision: string; previewUrl?: string;
  quality?: { reviewMode?: 'preview' | 'native'; nativeVerified?: boolean; decision: string; summary: string; defects: { component: string; timeSeconds: number; expected: string; observed: string }[];
    techniques: { id: string; name: string; status: string; evidence: string[] }[]; unknowns: string[]; limitations?: string[] } };
type Job = { id: string; status: "running" | "cancelling" | "cancelled" | "complete" | "failed" | "awaiting_approval" | "committing" | "blocked" | "discarded" | "interrupted"; canCancel: boolean; transcript: string[]; next: number; error?: string; result?: EditResult; previewUrl?: string; diagnostic?: Record<string, unknown> };

const field = "mt-2 w-full rounded-xl border border-white/15 bg-[#0b1220] px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300";
const button = "min-h-11 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40";

export default function KeyframeHelper({ setupComplete }: { setupComplete: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [discovery, setDiscovery] = useState<Discovery>();
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [clipIds, setClipIds] = useState<string[]>([]);
  const [editScope, setEditScope] = useState<'project' | 'clips'>('project');
  const [rawVideo, setRawVideo] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const referenceFile = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<Job["status"] | "idle">("idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [rawTranscript, setRawTranscript] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Job['diagnostic']>();
  const [result, setResult] = useState<EditResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [includeLocal, setIncludeLocal] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const offset = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const progress = readableProgress(transcript);

  const refresh = useCallback(async () => {
    const projectsResponse = await apiFetch(`/api/helper${includeLocal ? "?includeLocal=1" : ""}`, { cache: "no-store" });
    const projectData = await projectsResponse.json();
    if (!projectsResponse.ok) throw new Error(projectData.error || "Could not load projects.");
    const available = projectData.projects as Project[];
    setDiscovery(projectData.discovery);
    setProjects(available);
    setProjectId((current) => available.some((project) => project.id === current) ? current : available.length === 1 ? available[0].id : "");
  }, [includeLocal]);

  const project = projects.find((item) => item.id === projectId);
  const targetReady = project?.hasTimelineContent ? (editScope === 'project' ? project.clips.length > 0 : clipIds.length > 0 && clipIds.every(id => project.clips.some(clip => clip.id === id))) : Boolean(project && rawVideo);

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
        if (data.diagnostic) setDiagnostic(data.diagnostic);
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
    setPreviewUrl("");
    setTranscript([]);
    setDiagnostic(undefined);
    setJobId("");
    offset.current = 0;
    const form = new FormData();
    form.set("projectId", projectId);
    form.set('editScope', project?.hasTimelineContent ? editScope : 'project');
    if (project?.hasTimelineContent) form.set('clipIds', JSON.stringify(editScope === 'clips' ? clipIds : []));
    else if (rawVideo) form.set("rawVideo", rawVideo);
    form.set("prompt", prompt.trim());
    if (reference) form.set("reference", reference);
    if (referenceUrl.trim()) form.set("referenceUrl", referenceUrl.trim());
    try {
      const response = await apiFetch("/api/apply-native", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the edit.");
      window.sessionStorage.setItem("ai-editor-last-job", data.id);
      setStatus("running");
      setCanCancel(true);
      setJobId(data.id);
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


  async function createProject() {
    setStarting(true); setError("");
    try {
      const response = await apiFetch("/api/helper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-local-project" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not create a test project.");
      setIncludeLocal(true); await refresh(); setProjectId(data.projectId); setClipIds([]); setEditScope('project');
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a test project."); }
    finally { setStarting(false); }
  }

  async function downloadCompatibility(id: string) {
    setDownloadingReport(true);
    try {
      const response = await apiFetch(`/api/helper?download=compatibility&projectId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not collect the compatibility report.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'ai-editor-compatibility.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not collect the report.'); }
    finally { setDownloadingReport(false); }
  }

  const running = starting || status === "running" || status === "cancelling" || status === "committing";
  function chooseReference(file: File | null) {
    setReference(file);
    if (file) setReferenceUrl("");
    setPrompt(current => updateReferencePrompt(current, file ? (file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm)$/i.test(file.name) ? "video" : "image") : ""));
  }

  function changeReferenceUrl(value: string) {
    setReferenceUrl(value); setReference(null);
    if (referenceFile.current) referenceFile.current.value = "";
    setPrompt(current => updateReferencePrompt(current, value.trim() ? "link" : ""));
  }

  return <main className="min-h-screen bg-[#080c14] px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b border-white/10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">CapCut automation</p>
        <h1 className="mt-2 text-3xl font-semibold">Edit your CapCut project</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose a project and describe the changes. Work across its active timeline or check specific clips. A reference is optional.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-5 rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">01 · Project</p><h2 className="mt-2 text-xl font-semibold">Where to save your edit</h2></div>
          <label className="block text-sm text-slate-300">CapCut project
            <select className={field} value={projectId} disabled={running} onChange={(event) => { setProjectId(event.target.value); setClipIds([]); setEditScope('project'); setRawVideo(null); }}>
              <option value="">Select project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.kind === 'temporary-review' ? ' (temporary review copy)' : project.kind === 'test-project' ? ' (test project)' : ''} — {project.hasTimelineContent ? `${project.clips.length} video clips` : "Empty timeline"}</option>)}
            </select>
          </label>
          <button className="text-xs font-medium text-emerald-300 hover:text-emerald-200" disabled={running} onClick={() => void refresh().catch((cause) => setError(String(cause)))}>Refresh projects</button>
          <button className="ml-4 min-h-11 text-xs font-medium text-emerald-300" disabled={running} onClick={() => void createProject()}>Create disposable test project</button>
          <label className="flex min-h-11 items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={includeLocal} disabled={running} onChange={event => setIncludeLocal(event.target.checked)} />Show temporary review copies and test projects</label>
          {!!discovery?.hiddenReviewCopies && <p className="text-xs text-slate-300">{discovery.capcutProjectsFound} saved CapCut projects found. {discovery.hiddenReviewCopies} temporary review {discovery.hiddenReviewCopies === 1 ? 'copy is' : 'copies are'} hidden. Use the checkbox above to show them.</p>}
          {discovery && discovery.rootStatus !== 'available' && <p className="text-sm text-amber-200">{discovery.rootStatus === 'missing' ? 'The configured CapCut project folder was not found. Check your CapCut save location and the project-folder setting in the README.' : 'AI-Editor cannot read the CapCut project folder. Check the launching app’s file permissions, then refresh.'}</p>}
          {discovery?.unreadableProjects.map(item => <div key={item.id} className="rounded-lg border border-amber-300/30 p-3 text-xs text-amber-100">
            <p>{item.name}: {item.message}</p>
            <button className="mt-2 min-h-11 text-emerald-300" disabled={running || downloadingReport} onClick={() => void downloadCompatibility(item.id)}>Download compatibility report</button>
          </div>)}
          <p className="text-xs leading-5 text-slate-400">{project ? `Approved changes are saved back to “${project.name}”. A private working copy protects your project until approval.` : 'Select the existing project you want to update.'}</p>
          {project && <div className="text-xs text-slate-400"><button className="min-h-11 text-emerald-300" disabled={running || downloadingReport} onClick={() => void downloadCompatibility(project.id)}>{downloadingReport ? 'Collecting report…' : 'Download compatibility report'}</button><p>Checks the saved project version, keyframes and media paths without opening CapCut. The report excludes media, captions and personal paths.</p></div>}
          {projects.length === 0 && discovery?.rootStatus === 'available' && discovery.capcutProjectsFound === 0 && <p className="text-sm text-amber-200">No saved projects found in the configured CapCut folder. Save a project in CapCut, then refresh.</p>}
          {project?.hasTimelineContent ? <ClipSelection projectId={project.id} clips={project.clips} scope={editScope} selected={clipIds} disabled={running} onScope={setEditScope} onSelected={setClipIds} /> : <label className="block text-sm text-slate-300">Raw footage to add and edit
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
          <label className="block text-sm text-slate-300">What should Codex copy or change?
            <textarea className={`${field} min-h-28 resize-y`} value={prompt} placeholder="Describe the changes you want. Include exact words for any titles or captions." disabled={running} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} />
          </label>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold">Run the edit</h2><p className="mt-1 text-xs font-medium text-emerald-300">{editorPolicy.displayName} · Restricted candidate workspace</p><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">The editor builds a separate candidate, then reviewers check the evidence. Watch the design preview here. Review uses project files and the preview. AI-Editor does not open or close CapCut. Save your work first; close CapCut yourself before applying approved changes.</p>{status === "cancelled" && <p className="mt-2 text-sm text-amber-200" role="status">Run cancelled. No edit was written to CapCut.</p>}</div>
          <div className="flex flex-wrap gap-3"><button className={button} disabled={!setupComplete || running || !targetReady || !prompt.trim()} onClick={() => void runEdit()}>{starting ? "Starting…" : status === "cancelling" ? "Cancelling…" : running ? "Codex is editing…" : "Run"}</button>
          {jobId && running && <button className="min-h-11 rounded-xl border border-amber-300/40 px-5 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canCancel || status === "cancelling"} onClick={() => void cancelRun()}>{status === "cancelling" ? "Stopping tools…" : canCancel ? "Cancel run" : "Finishing write…"}</button>}</div>
        </div>
      </section>

      {previewUrl && !result && <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Early design preview</h2>
        <p className="mt-2 text-sm text-slate-400">Review is still in progress. CapCut-specific effects may differ.</p>
        <video controls preload="metadata" src={previewUrl} className="mt-4 max-h-96 w-full rounded-xl bg-black" />
      </section>}
      {(jobId || transcript.length > 0) && <section className="rounded-2xl border border-white/10 bg-[#111b2a] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Editing progress</h2><p className="mt-1 text-xs text-slate-400">{status === "cancelling" ? "Stopping tools…" : running ? "Live · analyzing and editing" : status === "complete" ? "Complete" : status === "cancelled" ? "Cancelled" : status === "failed" ? "Could not finish" : status === "blocked" ? "Needs review" : status === "awaiting_approval" ? "Ready for your approval" : "Stopped"}</p></div><button className="min-h-11 px-2 text-xs font-medium text-emerald-300" aria-pressed={rawTranscript} onClick={() => setRawTranscript((value) => !value)}>{rawTranscript ? "Show readable progress" : "Show diagnostic details"}</button></div>
        <p className="mt-4 rounded-lg bg-[#0b1220] p-3 text-xs text-slate-300">You: {prompt}</p>
        {jobId && <a href={`/api/apply-native?id=${encodeURIComponent(jobId)}&download=diagnostics`} download className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-emerald-300 hover:text-emerald-200">Download diagnostics</a>}
        <div className="mt-3 max-h-96 space-y-3 overflow-auto rounded-xl border border-white/10 bg-[#080c14] p-4" role="log" aria-live="polite" aria-label="Editing progress">
          {rawTranscript ? <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-300">{[transcript.join("\n\n"), diagnostic && JSON.stringify(diagnostic, null, 2)].filter(Boolean).join("\n\n") || "Waiting for Codex…"}</pre>
            : progress.length ? progress.map((entry, index) => <p key={index} className={`whitespace-pre-wrap break-words text-sm leading-6 ${entry.kind === 'error' ? 'text-red-300' : entry.kind === 'notice' ? 'text-amber-200' : 'text-slate-300'}`}>{entry.text}</p>)
              : <p className="text-sm text-slate-300">Waiting for the editing AI…</p>}
          <div ref={transcriptEnd} />
        </div>
      </section>}

      {result && <section className="rounded-2xl border border-emerald-300/25 bg-[#111b2a] p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{status === "complete" ? "Edit applied to" : "Candidate for"} {result.projectName}</h2>
        {result.projectPlan && <p className="mt-2 text-sm text-slate-300">Project plan: {result.projectPlan.summary}</p>}
        <p className="mt-2 text-sm text-slate-300">Requested techniques: {result.applied.join(", ")}.</p>
        {result.verified && <p className="mt-2 text-sm text-emerald-300">{result.quality?.reviewMode === 'preview' ? 'File and preview checks passed' : 'Native comparison passed'} after {result.iterations} {result.iterations === 1 ? "iteration" : "iterations"} · {result.model} · {result.access}</p>}
        <p className="mt-2 text-xs text-slate-400">Tools used: {result.toolsUsed.join(", ") || "CapCut CLI"}. {result.verified ? (result.quality?.reviewMode === "preview" ? "CapCut playback was not inspected." : "Native verification passed.") : "Quality verification is incomplete. The candidate is available for inspection; your original has not been changed."}</p>
        {result.quality && <div className="mt-4 rounded-xl border border-amber-300/20 p-4">
          <p className="text-sm font-semibold">{result.quality.summary}</p>
          <ul className="mt-3 space-y-2 text-sm">{result.quality.techniques.map(technique => <li key={technique.id}>
            <span className="font-medium">{technique.name}</span>: {technique.status === 'matched' ? 'Preview comparison passed' : technique.status === 'defect' ? 'Needs correction' : 'Evidence still needed'}
          </li>)}</ul>
          {result.quality.defects.map((defect, index) => <p key={index} className="mt-2 text-xs text-amber-200">{defect.timeSeconds.toFixed(2)}s · {defect.observed} Expected: {defect.expected}</p>)}
          {result.quality.unknowns.length > 0 && <details className="mt-3 text-xs text-slate-300"><summary>Unresolved verification</summary><ul className="mt-2 space-y-2">{result.quality.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details>}
          {!!result.quality.limitations?.length && <details className="mt-3 text-xs text-slate-400"><summary>Review scope · information only</summary><ul className="mt-2 space-y-2">{result.quality.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
        </div>}
        {result.notes && <p className="mt-2 text-xs text-slate-400">{result.notes}</p>}
        {result.previewUrl && <div className="mt-5"><p className="mb-2 text-sm text-slate-300">{result.previewLabel || 'Design preview'} · CapCut-specific effects may differ</p><video controls preload="metadata" src={result.previewUrl} className="max-h-96 w-full rounded-xl bg-black" /></div>}
        <div className="mt-5 flex flex-wrap gap-3">
          {status === "complete" && <p role="status" className="text-sm text-emerald-200">Saved. Open this project in CapCut yourself when you are ready.</p>}
          {["awaiting_approval", "blocked"].includes(status) && <>
            <button className={button} disabled={!result.verified || status !== "awaiting_approval" || starting} onClick={() => void decide("approve")}>Apply to {result.projectName}</button>
            <button className="min-h-11 rounded-xl border border-white/20 px-5 py-3 text-sm" onClick={() => void decide("discard")}>Discard candidate</button>
          </>}
          {status === "discarded" && <p role="status">Candidate discarded. Original unchanged.</p>}
        </div>
        {result.backup && <p className="mt-4 break-all text-xs text-slate-500">Project backup: {result.backup}</p>}
        {result.evidencePath && <p className="mt-2 break-all text-xs text-slate-500">Review evidence: {result.evidencePath}</p>}
      </section>}
    </div>
  </main>;
}
