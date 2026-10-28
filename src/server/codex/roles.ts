import { join } from "node:path";
import { loadRoleInstructions } from "./context.mjs";
import { toolKnowledge, toolKnowledgeSummary } from "../setup/tool-knowledge";

export const roles = {
  planner: { model: "gpt-6.1-sol", effort: "medium", writes: false },
  editor: { model: "gpt-6.1-sol", effort: "medium", writes: false },
  motion: { model: "gpt-6.1-sol", effort: "medium", writes: false },
  captions: { model: "gpt-6-luna", effort: "high", writes: false },
  audio: { model: "gpt-6-luna", effort: "high", writes: false },
  reviewer: { model: "gpt-6.1-terra", effort: "medium", writes: false },
  manager: { model: "gpt-6.1-sol", effort: "medium", writes: false },
} as const;
export type Role = keyof typeof roles;
export async function workerContext(role: Role) {
  const [instructions, knowledge] = await Promise.all([loadRoleInstructions(join(process.cwd(), "ai"), role), toolKnowledge()]);
  const manifest = { version: instructions.version, role, sources: instructions.sources, inspectedAt: knowledge.inspectedAt, packages: knowledge.packages };
  return { text: `${instructions.text}\n\nInstalled tool inventory (host discovery; catalog availability is not execution proof):\n${toolKnowledgeSummary(knowledge, ["editor", "motion"].includes(role))}\n\nContext manifest: ${JSON.stringify(manifest)}`, manifest };
}
export async function roleContext(role: Role) {
  return (await workerContext(role)).text;
}
