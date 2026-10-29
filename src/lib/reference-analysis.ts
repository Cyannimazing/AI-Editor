import { structuredPolicyArgs } from "../server/codex/structured-policy.mjs";
import { editingMcpArgs } from "../server/codex/editing-mcp-config.mjs";
import { codexTransportArgs } from "../server/codex/transport.mjs";
import { findExecutable, codeModeHost } from "../server/platform/runtime.mjs";
import { availableModels, codexEnvironment } from "../server/codex/client";
import { roles, workerContext, type Role } from "../server/codex/roles";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCancellableProcess } from "./cancellable-process";
import { editorPolicy } from "./editor-policy.mjs";

export const editingAgent = editorPolicy;
export async function codexExecutable() {
  const path = findExecutable("codex");
  if (!path) throw new Error("Codex CLI is missing. Complete setup first.");
  return path;
}

export async function runCodexStream(executable: string, args: string[], cwd: string, prompt: string,
  onLine: (line: string) => void, timeoutMs = 600_000, signal?: AbortSignal,
  role: Role = "editor", candidate?: string, highReasoning = false) {
  const config = roles[role];
  const planning = role === 'planner';
  if (!planning && !codeModeHost()) throw new Error('Codex’s local tool host is missing. Install or update the official Codex app/CLI before starting MCP editing.');
  void candidate;
  const models = await availableModels();
  const model = models.find(item => item.id === config.model || item.model === config.model);
  const effort = highReasoning ? "high" : config.effort;
  if (!model) throw new Error(`${config.model} is unavailable to this Codex account. No model or billing fallback was used.`);
  if (model.supportedReasoningEfforts?.length && !model.supportedReasoningEfforts.some(item => item.reasoningEffort === effort)) throw new Error(`The selected model does not support ${effort} reasoning.`);
  const [subcommand, ...options] = args;
  const context = await workerContext(role);
  await writeFile(join(cwd, `context-manifest-${role}.json`), JSON.stringify(context.manifest, null, 2));
  onLine(`Loaded ${role} context: ${context.manifest.sources.length} guides and the inspected local tool inventory.`);
  onLine(`${role}: ${config.model}, ${effort} reasoning. ${planning ? 'Planning the selected scope; no editing tools.' : `Local MCP tools ${role === 'editor' ? 'inspect evidence and build the candidate' : 'inspect evidence without changing the candidate'}.`}`);
  await runCancellableProcess(executable, [subcommand, "--ignore-user-config", "--ignore-rules", "--strict-config",
    ...codexTransportArgs(), ...structuredPolicyArgs(cwd, process.platform, !planning), ...(planning ? [] : editingMcpArgs(cwd, role)),
    "--model", config.model, "--config", `model_reasoning_effort="${effort}"`, "--config", 'service_tier="default"',
    ...options],
    { cwd, stdin: `${context.text}\n\n${planning ? 'Execution mode: project routing only. Tools are unavailable in this stage. Use the provided inventory and evidence to assign the requested work; do not attempt the editing workflow yet.' : `Execution mode: use only the ai_editor local MCP tools to inspect timed evidence and test/edit the candidate. Call inspect_job first. Request individual reference/source/preview frames around important motion boundaries. ${['editor', 'motion'].includes(role) ? 'Test the complete plan with evaluate_keyframes before submitting it.' : 'Inspect relevant written components with inspect_timeline; do not invent a complete plan from a partial specialist view.'} ${role === 'editor' ? 'You may apply_edit_plan to build native candidate layers/curves, then inspect_timeline to verify the actual saved controls. The host still resolves effects and independently reviews the final plan.' : 'Your tools are read-only; propose corrections for the lead editor.'}`} Do not use shell, patch, unrelated plugins, arbitrary files, desktop operations or paid services. Return the required structured JSON as your final answer.\n\n${prompt}`, signal, timeoutMs, onLine, env: codexEnvironment() });
}
