"use client";

import { useEffect, useRef, useState } from "react";
import KeyframeHelper from "./keyframe-helper";

type SetupData = {
  stage: string;
  progress: number;
  detail: string;
  error: string | null;
  tools: {
    ffmpeg: boolean;
    remotion: boolean;
    hyperframes: boolean;
    videoUse: boolean;
    groq: boolean;
  };
};

const rotatingWords = [
  "Preparing your workspace",
  "Checking media tools",
  "Loading motion engines",
  "Getting your studio ready",
];

export default function StartupWorkspace() {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [word, setWord] = useState(0);
  const [continueWithoutTools, setContinueWithoutTools] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;
    const timer = window.setInterval(() => {
      setWord((current) => (current + 1) % rotatingWords.length);
    }, 1700);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const response = await fetch("/api/setup", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not check the local tools.");
        const current = (await response.json()) as SetupData;
        if (cancelled) return;
        setSetup(current);

        if (current.stage === "idle" && !started.current) {
          started.current = true;
          const start = await fetch("/api/setup", { method: "POST" });
          if (!start.ok) throw new Error("Could not start local setup.");
        }
        if (current.stage !== "ready" && current.stage !== "error") {
          timer = setTimeout(refresh, 900);
        }
      } catch (error) {
        if (cancelled) return;
        setSetup({
          stage: "error",
          progress: 0,
          detail: "Setup needs attention",
          error: error instanceof Error ? error.message : "Unknown setup error",
          tools: {
            ffmpeg: false,
            remotion: false,
            hyperframes: false,
            videoUse: false,
            groq: false,
          },
        });
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [retryCount]);

  async function retry() {
    started.current = true;
    setContinueWithoutTools(false);
    setSetup((current) => current ? { ...current, stage: "starting", progress: 0, error: null } : null);
    const response = await fetch("/api/setup", { method: "POST" });
    if (!response.ok) {
      setSetup((current) => current ? { ...current, stage: "error", error: "Could not restart setup." } : null);
      return;
    }
    setRetryCount((count) => count + 1);
  }

  const ready = setup?.stage === "ready" || continueWithoutTools;
  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080c14] px-5 py-12 text-slate-100">
        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#101827] p-6 shadow-2xl shadow-black/40 sm:p-10">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300 text-slate-950">
              <span className="text-xl font-black">C</span>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide">CapCut Automation</p>
              <p className="text-xs text-slate-400">Local editing workspace</p>
            </div>
          </div>

          <p className="text-sm font-medium uppercase tracking-[0.22em] text-cyan-300">
            First launch setup
          </p>
          <h1 className="mt-3 min-h-20 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl" aria-hidden="true">
            {setup?.stage === "error" ? "Setup needs attention" : rotatingWords[word]}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300" role="status" aria-live="polite">
            {setup?.detail ?? "Checking your local tools"}
          </p>

          <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar"
            aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={setup?.progress ?? 0}>
            <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: (setup?.progress ?? 0) + "%" }} />
          </div>
          <div className="mt-3 flex justify-between text-xs text-slate-400">
            <span>{setup?.stage === "error" ? "Stopped" : "Installing tools on this computer"}</span>
            <span>{setup?.progress ?? 0}%</span>
          </div>

          <div className="mt-8 grid gap-3 border-t border-white/10 pt-7 text-sm sm:grid-cols-2">
            <p className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
              <span>FFmpeg + FFprobe</span><span className="text-cyan-300">{setup?.tools.ffmpeg ? "Ready" : "Preparing"}</span>
            </p>
            <p className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
              <span>Remotion</span><span className="text-cyan-300">{setup?.tools.remotion ? "Ready" : "Preparing"}</span>
            </p>
            <p className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
              <span>HyperFrames</span><span className="text-cyan-300">{setup?.tools.hyperframes ? "Ready" : "Preparing"}</span>
            </p>
            <p className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
              <span>Groq</span><span className="text-slate-400">Optional</span>
            </p>
          </div>

          {setup?.stage === "error" && (
            <div className="mt-7 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="text-sm text-amber-100">{setup.error}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => void retry()}
                  className="min-h-11 cursor-pointer rounded-lg bg-cyan-300 px-5 font-semibold text-slate-950 transition-colors hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
                  Retry setup
                </button>
                <button onClick={() => setContinueWithoutTools(true)}
                  className="min-h-11 cursor-pointer rounded-lg border border-white/20 px-5 text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
                  Open keyframe helper
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  return <KeyframeHelper setupComplete={setup?.stage === "ready"} />;
}
