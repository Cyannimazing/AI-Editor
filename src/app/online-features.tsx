"use client";
import CapcutConnection from "./capcut-connection";

/** Informational only: connecting an account never enables uploads or purchases. */
export default function OnlineFeatures({ installed }: { installed: boolean }) {
  return <section className="mt-6 rounded-2xl border border-white/10 bg-[#111b2a] p-6 sm:p-8" aria-labelledby="online-title">
    <div className="flex flex-wrap items-center gap-3">
      <h2 id="online-title" className="text-xl font-medium">Official CapCut MCP</h2>
      <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">Optional</span>
    </div>
    <p className="mt-3 text-sm leading-6 text-slate-300">This optional CapCut sign-in enables official material discovery through Codex CLI. Local editing MCP already works with your ChatGPT sign-in and needs no separate CapCut account.</p>
    {installed && <CapcutConnection />}
    {!installed && <p className="mt-4 text-sm leading-6 text-slate-400">The compatible official CapCut plugin is not installed in Codex. You can continue local editing without it.</p>}
    <details className="mt-5 text-sm"><summary className="min-h-11 cursor-pointer text-slate-300">About available CapCut features</summary><dl className="mt-3 space-y-4 text-sm">
      <div><dt className="font-medium text-slate-100">Find templates and inspiration</dt><dd className="mt-1 leading-6 text-slate-400">Search CapCut’s online template collection for styles, pacing and editing ideas.</dd></div>
      <div><dt className="font-medium text-slate-100">Edit a shared web project</dt><dd className="mt-1 leading-6 text-slate-400">Work with the AI on the same CapCut Web draft. This uses cloud storage and can require uploading selected media.</dd></div>
      <div><dt className="font-medium text-slate-100">Use CapCut’s online caption tools</dt><dd className="mt-1 leading-6 text-slate-400">Use its automatic caption workflow when local tools do not cover the task. Media processing can happen online.</dd></div>
      <div><dt className="font-medium text-slate-100">Generate images and video</dt><dd className="mt-1 leading-6 text-slate-400">CapCut offers online AI generation. Some operations spend CapCut credits. Paid generation is disabled in AI-Editor.</dd></div>
    </dl></details>
    <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">Codex can request official materials during Run. The controller performs the search and supplies the results to its editing plan. Paid generation, uploads and cloud project writes remain disabled.</p>
    <p className="mt-4 text-sm leading-6 text-slate-400">For local graphics and animation, AI-Editor’s CLI can use GSAP, HyperFrames, Remotion and FFmpeg. Photorealistic AI image or video generation needs a separately supported model or service.</p>
  </section>;
}
