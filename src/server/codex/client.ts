import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { findExecutable } from "../platform/runtime.mjs";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Account = { type: string; email?: string; planType?: string };
export type Model = { id: string; model: string; supportedReasoningEfforts?: { reasoningEffort: string }[] };

/** Credentials stay with Codex. This process never receives API-key overrides. */
export function codexEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/(API_KEY|ACCESS_TOKEN|SECRET|PASSWORD)/i.test(key)) delete env[key];
  return env;
}

class CodexConnection {
  readonly runtimeVersion = 2;
  child?: ChildProcessWithoutNullStreams;
  ready?: Promise<void>;
  sequence = 0;
  pending = new Map<number, Pending>();
  buffer = "";
  loginId?: string;
  loginUrl?: string;
  notifications = new Set<(method: string, params: unknown) => void>();
  subscribe(listener: (method: string, params: unknown) => void) { this.notifications.add(listener); return () => this.notifications.delete(listener); }
  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const executable = findExecutable("codex");
      if (!executable) throw new Error("Codex CLI was not found. Install the official Codex desktop app or CLI, then retry.");
      const child = spawn(executable, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: codexEnvironment() });
      this.child = child;
      child.stderr.on("data", () => undefined);
      child.stdout.on("data", chunk => {
        this.buffer += String(chunk);
        if (this.buffer.length > 8_000_000) { child.kill(); return; }
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.method === "account/login/completed") { this.loginId = undefined; this.loginUrl = undefined; }
            if (message.method) {
              if (message.id !== undefined) {
                // This client never silently accepts a server-initiated approval or URL flow.
                child.stdin.write(JSON.stringify(message.method === "mcpServer/elicitation/request"
                  ? { id: message.id, result: { action: "decline", content: null } }
                  : { id: message.id, error: { code: -32601, message: "Interactive tool approval is not enabled for this operation." } }) + "\n");
              } else for (const listener of this.notifications) { try { listener(message.method, message.params); } catch { /* A listener must not corrupt the protocol. */ } }
              continue;
            }
            const call = this.pending.get(message.id);
            if (call) { clearTimeout(call.timer); this.pending.delete(message.id);
              if (message.error) call.reject(new Error(message.error.message ?? "Codex request failed.")); else call.resolve(message.result); }
          } catch { /* Ignore non-protocol diagnostic lines. */ }
        }
      });
      const close = () => { this.ready = undefined; this.child = undefined; this.buffer = "";
        for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error("Codex connection closed. Retry setup.")); } this.pending.clear(); };
      child.once("error", close); child.once("exit", close); child.stdin.once("error", close);
      await this.call("initialize", { clientInfo: { name: "ai_editor", version: "0.2.0" }, capabilities: {} });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    })().catch(error => { this.child?.kill(); this.ready = undefined; throw error; });
    return this.ready;
  }
  call<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child?.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async request<T>(method: string, params: unknown = {}, timeoutMs = 20_000): Promise<T> { await this.start(); return this.call<T>(method, params, timeoutMs); }
}

const store = globalThis as typeof globalThis & { __editorCodex?: CodexConnection };
if (store.__editorCodex && store.__editorCodex.runtimeVersion !== 2) { store.__editorCodex.child?.kill(); store.__editorCodex = undefined; }
export const codex = store.__editorCodex ??= new CodexConnection();

export async function accountStatus() {
  const data = await codex.request<{ account: Account | null }>("account/read", { refreshToken: false });
  return { signedIn: data.account?.type === "chatgpt", plan: data.account?.type === "chatgpt" ? data.account.planType : undefined };
}
export async function requireAccount() { if (!(await accountStatus()).signedIn) throw new Error("Sign in to Codex with ChatGPT before editing. API keys are not supported."); }
export async function availableModels() {
  await requireAccount();
  const result = await codex.request<{ data: Model[] }>("model/list", { limit: 100 });
  return result.data;
}
export async function startLogin() {
  if (codex.loginUrl) return { url: codex.loginUrl };
  const result = await codex.request<{ authUrl: string; loginId: string }>("account/login/start", { type: "chatgpt" });
  const url = new URL(result.authUrl);
  if (url.protocol !== "https:" || !["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(url.hostname)) throw new Error("Codex returned an unexpected login destination.");
  codex.loginId = result.loginId; codex.loginUrl = result.authUrl;
  return { url: result.authUrl };
}
