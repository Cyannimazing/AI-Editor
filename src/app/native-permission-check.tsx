"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

type PermissionReport = {
  ok: boolean;
  compatibility: "passed" | "failed" | "not_applicable";
  message: string;
  accessibility?: boolean;
  screenRecording?: boolean;
};

export default function NativePermissionCheck() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PermissionReport | null>(null);
  const [error, setError] = useState("");

  async function check() {
    setBusy(true); setError(""); setReport(null);
    try {
      const response = await apiFetch("/api/native-preflight", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check Mac permissions.");
      setReport(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check Mac permissions.");
    } finally { setBusy(false); }
  }

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "ai-editor-mac-permissions.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const button = "min-h-11 rounded-xl border border-white/20 px-4 py-2 text-sm text-emerald-300 hover:bg-white/5 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300";
  return <section className="mt-6 rounded-2xl border border-white/10 bg-[#111b2a] p-6" aria-labelledby="mac-permission-heading">
    <h2 id="mac-permission-heading" className="text-lg font-medium">Mac permissions</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Check Accessibility and Screen Recording before running an edit. This checks access only: it does not open CapCut, capture your screen or use your AI allowance.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className={button} disabled={busy} onClick={() => void check()}>{busy ? "Checking permissions…" : "Check Mac permissions"}</button>
      {report && <button className={button} onClick={download}>Download check report</button>}
    </div>
    <div role="status" className="mt-3 text-sm leading-6">
      {busy && <p>Checking access through the app that started AI-Editor…</p>}
      {report && <>
        <p className={report.ok ? "text-emerald-200" : "text-amber-100"}>{report.message}</p>
        {report.compatibility === "passed" && <dl className="mt-3 text-slate-300">
          <div className="flex gap-3"><dt>Compatibility check</dt><dd>Passed</dd></div>
          <div className="flex gap-3"><dt>Accessibility</dt><dd>{report.accessibility ? "Allowed" : "Permission needed"}</dd></div>
          <div className="flex gap-3"><dt>Screen Recording</dt><dd>{report.screenRecording ? "Allowed" : "Permission needed"}</dd></div>
        </dl>}
      </>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-amber-100">{error}</p>}
  </section>;
}
