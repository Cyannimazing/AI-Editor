import { codex, requireAccount } from "../codex/client";
import { capcutAuthorizationUrl, materialSearchArguments, materialSearchTool, materialSearchItems } from "./plugin-policy.mjs";
import { localEffectBuilder } from './local-builder.mjs';

type Login = { state: "idle" | "starting" | "waiting" | "connected" | "failed"; url?: string; id?: string; expiresAt?: number; detail?: string };
type Tool = { name: string; title?: string; description?: string; inputSchema?: { properties?: Record<string, unknown> }; annotations?: Record<string, unknown> };
type Server = { name: string; httpOrigin?: string; runtimeStatus?: string; authStatus?: string; tools: Record<string, Tool>; toolsError?: string };
const state = globalThis as typeof globalThis & { __capcutLogin?: Login; __capcutStarting?: Promise<Login>; __capcutSubscription?: () => void;
  __capcutThread?: { owner: unknown; value: Promise<string> } };
state.__capcutLogin ??= { state: "idle" };
state.__capcutSubscription?.();
state.__capcutSubscription = codex.subscribe((method, value) => {
  if (method !== "mcpServer/oauthLogin/completed") return;
  const event = value as { name?: string; loginId?: string; success?: boolean };
  const login = state.__capcutLogin!;
  if (event.name !== "capcut_creation" || !["starting", "waiting"].includes(login.state) || (login.id && event.loginId && login.id !== event.loginId)) return;
  state.__capcutLogin = event.success ? { state: "connected", detail: "CapCut authorization completed. Checking usable tools." }
    : { state: "failed", detail: "CapCut sign-in did not complete. Start a fresh connection when ready." };
});

export async function capcutServer(threadId?: string) {
  const result = await codex.request<{ data: Server[] }>("mcpServerStatus/list", { serverName: "capcut_creation", detail: "toolsAndAuthOnly", ...(threadId ? { threadId } : {}) });
  const server = result.data?.find(item => item.name === "capcut_creation");
  if (server?.httpOrigin && server.httpOrigin !== "https://www.capcut.com") throw new Error("The configured CapCut server has an unexpected origin.");
  return server;
}

async function capcutThread() {
  const cached = state.__capcutThread;
  if (cached && cached.owner === codex.child) return cached.value;
  const value = codex.request<{ thread: { id: string } }>("thread/start", { cwd: process.cwd(), ephemeral: true, model: "gpt-6.1-sol",
    approvalPolicy: "never", sandbox: "read-only", config: { "features.shell_tool": false, "features.unified_exec": false, "features.computer_use": false, "features.browser_use": false } })
    .then(result => result.thread.id);
  state.__capcutThread = { owner: codex.child, value };
  try { return await value; } catch (error) { if (state.__capcutThread?.value === value) state.__capcutThread = undefined; throw error; }
}

export async function capcutPluginStatus() {
  await requireAccount();
  let login = state.__capcutLogin!;
  if (login.state === "waiting" && Date.now() > (login.expiresAt || 0)) state.__capcutLogin = login = { state: "failed", detail: "The sign-in request expired. Start a fresh connection." };
  let server = await capcutServer();
  // App-scoped discovery can return cached tools with runtimeStatus=null. Verify
  // the live thread connection instead of treating catalog presence as success.
  if (server?.runtimeStatus == null && server?.authStatus === "oAuth") server = await capcutServer(await capcutThread());
  const connected = server?.runtimeStatus === "connected";
  let materialSearchAvailable = false;
  if (connected && server) { try { materialSearchTool(server.tools); materialSearchAvailable = true; } catch { /* Report the capability independently from login. */ } }
  if (connected && login.state === "connected") login = { state: "connected", detail: "CapCut authorization completed." };
  const builder = localEffectBuilder();
  return { authorization: connected ? "connected" : server?.authStatus === "notLoggedIn" || server?.runtimeStatus === "authenticationRequired" ? "login_required" : "unverified",
    login: { state: login.state, ...(login.state === "waiting" ? { url: login.url, expiresAt: login.expiresAt } : {}), detail: login.detail },
    capabilities: { materialSearch: materialSearchAvailable, localEffectBuilder: builder.available, toolCount: Object.keys(server?.tools || {}).length, uploads: false, paidGeneration: false, cloudEditing: false },
    connection: { runtime: server?.runtimeStatus ?? null, auth: server?.authStatus ?? null },
    detail: connected ? materialSearchAvailable ? builder.available
      ? 'While editing, AI-Editor automatically finds official effects and applies supported effects to the local candidate. Native playback still requires verification. No uploads or paid generation.'
      : `Official CapCut material discovery is available. ${builder.reason}`
      : "CapCut is connected; the material-search capability has not been verified."
      : "Connect CapCut here to discover its available official editing tools. Local draft editing stays available without this connection." };
}

export async function connectCapcut() {
  await requireAccount();
  const current = state.__capcutLogin!;
  if (current.state === "waiting" && Date.now() < (current.expiresAt || 0)) return current;
  if (state.__capcutStarting) return state.__capcutStarting;
  state.__capcutStarting = (async () => {
    state.__capcutLogin = { state: "starting" };
    try {
      const result = await codex.request<{ authorizationUrl: string; loginId?: string }>("mcpServer/oauth/login", { name: "capcut_creation", timeoutSecs: 600 }, 60000);
      const url = capcutAuthorizationUrl(result.authorizationUrl);
      // Codex owns the local callback and credentials; this URL stays in memory only.
      if (state.__capcutLogin?.state === "connected" || state.__capcutLogin?.state === "failed") return state.__capcutLogin;
      return state.__capcutLogin = { state: "waiting", id: result.loginId, url, expiresAt: Date.now() + 600000,
        detail: "Complete CapCut sign-in in the official page, then return here. Keep AI-Editor running." };
    } catch { state.__capcutLogin = { state: "failed", detail: "CapCut sign-in could not start. Check the installed plugin and retry." }; return state.__capcutLogin; }
  })().finally(() => { state.__capcutStarting = undefined; });
  return state.__capcutStarting;
}

export async function searchCapcutMaterials(input: { kind: string; query: string }, resultCount = 5) {
  await requireAccount();
  const args = materialSearchArguments(input);
  if (!Number.isInteger(resultCount) || resultCount < 1 || resultCount > 20) throw new Error('Invalid material result count.');
  args.top_n = resultCount;
  const status = await capcutPluginStatus();
  if (status.authorization !== "connected") throw new Error("Connect CapCut before searching its official materials.");
  const threadId = await capcutThread();
  const server = await capcutServer(threadId);
  if (!server || server.runtimeStatus !== "connected") throw new Error("The CapCut connection is not usable in this session. Recheck the connection.");
  const tool = materialSearchTool(server.tools);
  const result = await codex.request<{ isError?: boolean; content: unknown[]; structuredContent?: unknown }>("mcpServer/tool/call", {
    threadId, server: server.name, tool, arguments: args,
  }, 90000);
  if (result.isError) throw new Error("CapCut material search failed. No material was applied or purchased.");
  return { provider: "official-capcut-plugin", kind: input.kind, query: input.query, applied: false,
    items: materialSearchItems(result) };
}
