"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Connection = { authorization: string; detail: string; login: { state: string; url?: string; detail?: string };
  capabilities: { materialSearch: boolean; toolCount: number } };
const action = "min-h-11 rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50";

export default function CapcutConnection() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const refresh = useCallback(async () => {
    const response = await apiFetch("/api/plugin"); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check CapCut.");
    setConnection(data); if (data.login?.url) setLoginUrl(data.login.url);
    if (data.authorization === "connected" || data.login?.state === "failed") setLoginUrl("");
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh).catch(cause => setError(cause instanceof Error ? cause.message : "Connection check failed."));
  }, [refresh]);
  useEffect(() => {
    if (connection?.login.state !== "waiting" && !loginUrl) return;
    const timer = setInterval(() => { void refresh().catch(() => setError("Reconnecting to the CapCut sign-in status…")); }, 4000);
    return () => clearInterval(timer);
  }, [refresh, connection?.login.state, loginUrl]);

  async function connect() {
    setBusy(true); setError("");
    // Open synchronously from the user's click; fall back to a link if blocked.
    const popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null;
    try {
      const response = await apiFetch("/api/plugin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect" }) });
      const data = await response.json();
      if (!response.ok || data.state === "failed") throw new Error(data.error || data.detail || "CapCut sign-in could not start.");
      if (data.url) { setLoginUrl(data.url); if (popup) popup.location.href = data.url; }
      else popup?.close();
      await refresh();
    } catch (cause) { popup?.close(); setError(cause instanceof Error ? cause.message : "Could not connect CapCut."); }
    finally { setBusy(false); }
  }
  const connected = connection?.authorization === "connected";
  return <div className="mt-5 space-y-3">
    <p role="status" className="text-sm text-slate-300">{connected ? "CapCut MCP connected through Codex CLI" : !connection ? "Checking CapCut connection…" : connection.login.state === "waiting" ? "Waiting for optional CapCut sign-in" : "Optional CapCut MCP is not connected"}</p>
    <div className="flex flex-wrap gap-3">
      {!connected && <button className={action} disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : loginUrl ? "Continue CapCut sign-in" : "Sign in to CapCut MCP"}</button>}
      <button className={action} disabled={busy} onClick={() => void refresh().catch(cause => setError(String(cause)))}>Check connection</button>
    </div>
    {loginUrl && !connected && <p className="text-sm leading-6 text-slate-300"><a className="text-emerald-300 underline" href={loginUrl} target="_blank" rel="noopener noreferrer">Open official CapCut sign-in</a>. Complete sign-in and consent, then return here. Keep AI-Editor running; it owns the callback.</p>}
    {connection && <p className="text-xs leading-5 text-slate-400">{connection.detail} {connection.login.detail}</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}

  </div>;
}
