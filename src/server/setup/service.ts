import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { accountStatus, requireAccount } from "../codex/client";
import { findExecutable, platformPaths, codeModeHost } from "../platform/runtime.mjs";
import { nativeReviewCapability } from "../capcut/review";
import { isolationStatus } from "../codex/isolation";
import { toolKnowledge } from "./tool-knowledge";
import { loadRoleInstructions } from "../codex/context.mjs";
import { roles } from "../codex/roles";
import { motionRuntimeReady } from '../editing/motion-runtime.mjs';
import { previewBrowser } from '../platform/browser.mjs';
import { setupReceiptCurrent, setupView } from './requirements.mjs';
import { installedCapcutPlugin } from '../capcut/local-builder.mjs';

const root = process.cwd();
const statePath = join(root, ".local-tools", "setup-state.json");
type State = { stage: string; progress: number; detail: string; error: string | null };
const store = globalThis as typeof globalThis & { __editorSetup?: ChildProcess; __editorSetupStarting?: Promise<void> };

export async function setupStatus() {
  const toolsRoot = join(root, "toolchain", "node_modules");
  const tools = { ffmpeg: Boolean(findExecutable("ffmpeg") && findExecutable("ffprobe")),
    remotion: existsSync(join(toolsRoot, "remotion", "package.json")), hyperframes: existsSync(join(toolsRoot, "hyperframes", "package.json")),
    capcutCli: existsSync(join(toolsRoot, "capcut-cli", "dist", "index.js")), motionAnalysis: await motionRuntimeReady(root),
    localMcp: existsSync(join(toolsRoot, '@modelcontextprotocol/sdk/package.json')), browser: Boolean(previewBrowser(root)) };
  let account = { signedIn: false, plan: undefined as string | undefined };
  let accountError: string | undefined;
  try { account = await accountStatus(); } catch (error) { accountError = error instanceof Error ? error.message : "Codex is unavailable."; }
  let state: State = { stage: "idle", progress: 0, detail: "Preparing your local editing tools", error: null };
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { /* first launch */ }
  state = setupView({ state, signedIn: account.signedIn, accountError, toolsReady: Object.values(tools).every(Boolean),
    receiptCurrent: await setupReceiptCurrent(root), running: Boolean(store.__editorSetup || store.__editorSetupStarting), hostReady: Boolean(codeModeHost()) });
  let context = { ready: false, detail: "Tool context is prepared after account and tool setup." };
  if (state.stage === 'ready') {
    try {
      const knowledge = await toolKnowledge();
      await Promise.all(Object.keys(roles).map(role => loadRoleInstructions(join(root, "ai"), role)));
      context = { ready: true, detail: `Installed tool contracts learned (${knowledge.packages.length} packages).` };
    }
    catch (error) { state = { stage: "error", progress: 0, detail: "Editing tool context needs attention", error: error instanceof Error ? error.message : "Tool context could not load." }; }
  }
  const pluginInstalled = Boolean(installedCapcutPlugin());
  const isolation = account.signedIn && Object.values(tools).every(Boolean) ? await isolationStatus() : { available: false, reason: "Complete account and tool setup to check isolation." };
  return { ...state, account, tools, context, isolation, platform: process.platform, paths: platformPaths(),
    prerequisites: { codexInstalled: Boolean(findExecutable('codex')), nodeSupported: Number(process.versions.node.split('.')[0]) === 24,
      homebrewInstalled: process.platform !== 'darwin' || Boolean(findExecutable('brew')) },
    nativeReview: nativeReviewCapability(), plugin: { installed: pluginInstalled, authorization: "unverified", usable: false,
      detail: pluginInstalled ? "Installed. Check connection to verify authorization; native desktop verification is separate." : "The official CapCut plugin needs installation." } };
}

export async function startSetup() {
  await requireAccount();
  if (store.__editorSetup || store.__editorSetupStarting) return { started: false };
  store.__editorSetupStarting = (async () => {
    await mkdir(join(root, ".local-tools"), { recursive: true });
    await writeFile(statePath, JSON.stringify({ stage: "starting", progress: 0, detail: "Checking local tools", error: null }));
    const child = spawn(process.execPath, [join(root, "scripts", "bootstrap-tools.mjs")], { cwd: root, stdio: "ignore", windowsHide: true });
    store.__editorSetup = child;
    child.once("error", error => { store.__editorSetup = undefined; void writeFile(statePath, JSON.stringify({ stage: "error", progress: 0, detail: "Setup could not start", error: error.message })); });
    child.once("exit", () => { if (store.__editorSetup === child) store.__editorSetup = undefined; void isolationStatus(true); });
  })().finally(() => { store.__editorSetupStarting = undefined; });
  await store.__editorSetupStarting;
  return { started: true };
}
