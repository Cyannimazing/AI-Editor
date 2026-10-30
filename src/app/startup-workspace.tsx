"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import KeyframeHelper from "./keyframe-helper";
import OnlineFeatures from "./online-features";
import NativePermissionCheck from "./native-permission-check";

type Setup = {
  stage: string; progress: number; detail: string; error: string | null;
  account: { signedIn: boolean }; tools: Record<string, boolean>; platform: string;
  context?: { ready: boolean; detail: string };
  isolation: { available: boolean; reason: string };
  nativeReview: { available: boolean; appInstalled: boolean; reason: string };
  plugin: { installed: boolean; authorization: string; detail: string };
  prerequisites?: { codexInstalled: boolean; nodeSupported: boolean; homebrewInstalled: boolean };
};
const action = "min-h-11 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300";

export default function StartupWorkspace() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [workspace, setWorkspace] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await apiFetch("/api/setup");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Setup check failed.");
        if (cancelled) return;
        setSetup(data); setError("");
        if (data.stage === "idle" && !started.current) {
          started.current = true;
          const install = await apiFetch("/api/setup", { method: "POST" });
          if (!install.ok) throw new Error((await install.json()).error || "Setup failed.");
        }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not check setup."); }
      if (!cancelled) timer = setTimeout(refresh, 4000);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retry]);

  async function signIn() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/account", { method: "POST" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start sign-in.");
      setLoginUrl(data.url);
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setBusy(false); }
  }
  async function retrySetup() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/setup", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not resume setup.");
      started.current = true;
      setRetry(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resume setup."); }
    finally { setBusy(false); }
  }
  if (workspace && setup?.account.signedIn) return <>
    <div className="border-b border-white/10 bg-[#111b2a] px-6 py-3 text-sm text-slate-300">
      <button className="mr-4 min-h-11 text-emerald-300 underline" onClick={() => setWorkspace(false)}>Setup and connections</button>
      <button className="mr-4 min-h-11 text-emerald-300 underline" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen(value => !value)}>Tools &amp; CapCut connection</button>
      Review uses project files and the app preview. CapCut stays under your control.
    </div>
    {connectionsOpen && <aside aria-label="Workspace tools and connections" className="bg-[#080c14] px-5 py-4 text-slate-100"><div className="mx-auto max-w-6xl"><OnlineFeatures installed={Boolean(setup.plugin.installed)} /></div></aside>}
    {!setup.isolation.available && <p role="alert" className="bg-[#111b2a] px-6 py-3 text-sm text-amber-100">{setup.isolation.reason}</p>}
    <KeyframeHelper setupComplete={setup.stage === "ready" && setup.isolation.available} />
  </>;

  const checks = [
    ["Your Codex account", setup?.account.signedIn ? "Connected" : "Sign-in required"],
    ["Media tools", setup?.tools.ffmpeg ? "Ready" : "Preparing"],
    ["Animation tools", setup?.tools.hyperframes && setup?.tools.remotion ? "Installed" : "Preparing"],
    ["Motion measurement", setup?.tools.motionAnalysis ? "Ready" : "Preparing"],
    ["Background preview browser", setup?.tools.browser ? "Detected" : "Preparing"],
    ["CapCut project tools", setup?.tools.capcutCli ? "Installed" : "Preparing"],
    ["Local editing MCP", setup?.tools.localMcp ? "Installed; no separate sign-in" : "Preparing"],
    ["AI tool context", setup?.context?.ready ? "Ready — installed tools inspected" : "Preparing"],
    ["Official CapCut plugin (optional)", setup?.plugin.installed ? "Installed; sign-in optional" : "Not installed"],
    ["CapCut desktop", setup?.nativeReview.appInstalled ? "Detected" : "Not detected"],
    ["Editing engine", setup?.isolation.available ? "Ready — controlled native edits" : "Checking Codex compatibility"],
  ];
  return <main className="min-h-screen bg-[#080c14] px-5 py-12 text-slate-100 sm:py-20">
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">AI-Editor / Local workspace</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">Your editing workspace</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">Sign in with your ChatGPT account to use the AI. Local editing MCP connects automatically; it needs no extra account. We prepare the tools and keep your original safe until you approve.</p>
      <section className="mt-9 rounded-2xl border border-white/10 bg-[#111b2a] p-6 sm:p-8" aria-label="Workspace readiness">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-medium">{setup?.detail || "Checking your computer"}</h2><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{!setup ? "Checking platform" : setup.platform === "darwin" ? "macOS" : setup.platform === "win32" ? "Windows" : setup.platform}</span></div>
        <p className="mt-4 text-sm leading-6 text-slate-400">First setup downloads and checks the editing tools, so allow a few minutes and keep an internet connection. Later launches reuse them. Interrupted setup can be resumed here.</p>
        {setup && !['login', 'idle', 'ready', 'error'].includes(setup.stage) && <progress className="mt-4 h-2 w-full accent-emerald-300" aria-label="Tool setup progress" value={setup.progress} max={100} />}
        {error && <p role="alert" className="mt-5 rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">{error}</p>}
        {setup?.error && <p role="alert" className="mt-4 text-sm text-amber-200">{setup.error}</p>}
        <dl className="mt-6 divide-y divide-white/10">{checks.map(([name, value]) => <div key={name} className="flex flex-wrap justify-between gap-2 py-4 text-sm"><dt className="text-slate-300">{name}</dt><dd className="font-medium">{setup ? value : "Checking"}</dd></div>)}</dl>
        {setup?.prerequisites && !setup.prerequisites.codexInstalled && <p className="mt-4 text-sm leading-6 text-amber-100">Install the official Codex app/CLI with its bundled tool host, then return here. AI-Editor uses its sign-in; it never asks for your password or API key.</p>}
        {setup && !setup.account.signedIn && <div className="mt-6 space-y-4"><button className={action} disabled={busy || setup.prerequisites?.codexInstalled === false} onClick={() => void signIn()}>{busy ? "Starting sign-in…" : "Sign in with ChatGPT"}</button>{loginUrl && <p><a className="text-emerald-300 underline" href={loginUrl} target="_blank" rel="noopener noreferrer">Continue secure sign-in</a></p>}<p className="text-sm text-slate-400">Required for AI editing. Credentials stay with Codex and an existing sign-in is reused. API keys are not used.</p></div>}
        {setup?.account.signedIn && <div className="mt-6 flex flex-wrap gap-3">
          <button className={action} disabled={setup.stage !== "ready"} onClick={() => setWorkspace(true)}>Open workspace</button>
          {['error', 'idle'].includes(setup.stage) && <button className="min-h-11 rounded-xl border border-white/20 px-4 text-sm hover:bg-white/5 disabled:opacity-50" disabled={busy} onClick={() => void retrySetup()}>{busy ? "Resuming setup…" : "Resume tool setup"}</button>}
        </div>}
      </section>
      {setup?.platform === "darwin" && <details className="mt-6 text-sm text-slate-400"><summary>Optional Mac desktop diagnostics (not required for editing)</summary><NativePermissionCheck /></details>}
      {setup?.account.signedIn && <OnlineFeatures installed={Boolean(setup?.plugin.installed)} />}
      {setup?.account.signedIn && <p className="mt-5 text-sm leading-6 text-amber-100">{setup.nativeReview.reason}</p>}
      {setup?.account.signedIn && !setup.isolation.available && <p className="mt-4 text-sm leading-6 text-amber-100">{setup.isolation.reason}</p>}
      <p className="mt-6 text-xs leading-5 text-slate-500">Rendering and audio tools run locally. Your instructions and selected preview frames go to Codex for AI review using your account and its usage limits. CapCut cloud uploads and paid generation are not enabled.</p>
    </div>
  </main>;
}
