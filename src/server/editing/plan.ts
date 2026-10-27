import { createHash } from "node:crypto";
import type { NativeDraft } from "../../lib/native-edit-validation";

export type EditingPlan = {
  version: 1;
  revision: string;
  canvas: unknown;
  durationUs: number;
  nativeDraft: NativeDraft;
  preview: { kind: "approximate"; limitations: string[] };
};

/** Keep the full native graph so unknown supported metadata survives normalization. */
export function createEditingPlan(draft: NativeDraft): EditingPlan {
  if (!Array.isArray(draft.tracks) || !draft.materials || !Number.isFinite(draft.duration) || draft.duration <= 0) throw new Error("Invalid editing timeline.");
  const ids = new Set<string>();
  for (const track of draft.tracks) for (const segment of track.segments ?? []) {
    if (ids.has(segment.id)) throw new Error("Duplicate timeline segment.");
    ids.add(segment.id);
    const range = segment.target_timerange;
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.duration) || range.start < 0 || range.duration <= 0) throw new Error("Invalid segment timing.");
  }
  const snapshot = structuredClone(draft);
  return { version: 1, revision: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    canvas: snapshot.canvas_config, durationUs: snapshot.duration, nativeDraft: snapshot,
    preview: { kind: "approximate", limitations: ["CapCut effects, fonts, compound rendering and easing need native verification."] } };
}

export function nativeDraftFromPlan(plan: EditingPlan) {
  if (plan.version !== 1 || createEditingPlan(plan.nativeDraft).revision !== plan.revision) throw new Error("Editing plan integrity check failed.");
  return structuredClone(plan.nativeDraft);
}
