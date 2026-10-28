import { readFile, stat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

type Range = { start: number; duration: number };
type Material = { id: string; path?: string; type?: string; apply_target_type?: number; draft?: NativeDraft; [key: string]: unknown };
type Segment = { id: string; material_id: string; target_timerange: Range; extra_material_refs?: string[]; [key: string]: unknown };
type Track = { id: string; name?: string; type: string; flag?: number; segments: Segment[]; [key: string]: unknown };
export type NativeDraft = {
  duration: number; canvas_config?: unknown; fps?: number; tracks: Track[]; materials: Record<string, Material[]>;
};
export type NativeManifest = {
  supported: boolean;
  sourceSegmentIds: string[];
  effects: { id: string; technique: string; trackNames: string[]; segmentIds: string[]; method: string }[];
  toolsUsed: string[];
  limitations: string[];
  verificationGaps?: string[];
  notes: string;
};
export type ReferenceAnalysis = {
  techniques: { id: string; name: string; start: number; end: number; evidence: string; confidence: number }[];
};
export type NativeReview = {
  matched: boolean;
  nativeOutput: "capcut-preview" | "capcut-export" | "unavailable";
  candidateDigest: string;
  endToEnd: boolean;
  audioChecked: boolean;
  nativeControlsChecked: boolean;
  playbackPath: string;
  openingFrame: string;
  endingFrame: string;
  comparisons: { techniqueId: string; matched: boolean; referenceTime: number; targetTime: number; previewFrame: string; notes: string }[];
  mismatches: string[];
  notes: string;
};

export function isInside(folder: string, file: string) {
  const offset = relative(resolve(folder), resolve(file));
  return offset !== ".." && !offset.startsWith("../") && !offset.startsWith("..\\") && !isAbsolute(offset);
}

function nestedDrafts(draft: NativeDraft): NativeDraft[] {
  return [draft, ...Object.values(draft.materials ?? {}).flatMap((items) => !Array.isArray(items) ? [] :
    items.flatMap((item) => item.draft ? nestedDrafts(item.draft) : []))];
}

export async function validateNativeCandidate(input: {
  original: NativeDraft; candidate: NativeDraft; manifest: NativeManifest; analysis: ReferenceAnalysis;
  clipId?: string; start: number; duration: number; candidatePath: string; sourcePaths: string[]; width: number; height: number;
  compositionEffectIds?: string[];
}) {
  const { original, candidate, manifest, analysis, clipId, start, duration, candidatePath } = input;
  if (!candidate || !Array.isArray(candidate.tracks) || !candidate.materials || candidate.tracks.length > 100 ||
    (clipId && !isDeepStrictEqual(original.canvas_config, candidate.canvas_config)) ||
    (clipId && (candidate.duration !== original.duration || candidate.fps !== original.fps))) throw new Error("The candidate changed the canvas, frame rate or project duration.");
  const canvas = candidate.canvas_config as { width?: number; height?: number } | undefined;
  if (canvas?.width !== input.width || canvas?.height !== input.height) throw new Error("The native canvas does not match the requested dimensions.");
  if (!manifest.supported || manifest.limitations.length) throw new Error(manifest.limitations.join("; ") || manifest.notes || "The native edit is incomplete.");
  if (!Array.isArray(analysis.techniques) || !analysis.techniques.length || analysis.techniques.some((item) =>
    !item.id || !item.evidence || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start ||
    !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) throw new Error("Missing time-based reference evidence.");
  const children = nestedDrafts(candidate);
  const tracks = children.flatMap((draft) => draft.tracks);
  const segments = tracks.flatMap((track) => track.segments);
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const names = new Set(tracks.flatMap((track) => [track.id, track.name]));
  const techniques = new Set(manifest.effects.map((effect) => effect.id));
  if (!manifest.effects.length || techniques.size !== manifest.effects.length || analysis.techniques.some((item) => !techniques.has(item.id)) ||
    manifest.effects.some((effect) => !effect.method || !effect.trackNames.length || !effect.segmentIds.length ||
      effect.trackNames.some((name) => !names.has(name)) || effect.segmentIds.some((id) => !segmentIds.has(id)))) {
    throw new Error("Every observed technique must map to existing native tracks and segments.");
  }
  const sourceIds = new Set(manifest.sourceSegmentIds);
  const rootSegments = candidate.tracks.flatMap((track) => track.segments);
  const sourceSegments = rootSegments.filter((segment) => sourceIds.has(segment.id)).sort((a, b) => a.target_timerange.start - b.target_timerange.start);
  if (!sourceSegments.length || sourceSegments.length !== sourceIds.size) throw new Error("The native source segments are missing.");
  const tolerance = 2;
  let cursor = start;
  for (const segment of sourceSegments) {
    if (Math.abs(segment.target_timerange.start - cursor) > tolerance || segment.target_timerange.duration <= 0) throw new Error("The edited source has a gap or overlap.");
    cursor = segment.target_timerange.start + segment.target_timerange.duration;
  }
  if (Math.abs(cursor - start - duration) > (clipId ? tolerance : Math.max(tolerance, 1_000_000 / (candidate.fps || 30)))) throw new Error("The edited source changed the selected duration.");
  const originalSegmentIds = new Set(original.tracks.flatMap((track) => track.segments.map((segment) => segment.id)));
  const untouched = original.tracks.flatMap((track) => track.segments.filter((segment) => segment.id !== clipId));
  for (const track of original.tracks) {
    const updated = candidate.tracks.find((item) => item.id === track.id);
    const { segments: ignoredBefore, ...before } = track;
    const { segments: ignoredAfter, ...after } = updated ?? { segments: [] };
    void ignoredBefore; void ignoredAfter;
    if (!updated || !isDeepStrictEqual(before, after)) throw new Error("The candidate changed an existing track's settings.");
    for (const segment of track.segments.filter((segment) => segment.id !== clipId)) {
      if (!isDeepStrictEqual(segment, updated.segments.find((item) => item.id === segment.id))) throw new Error("The candidate changed an unrelated timeline clip.");
    }
  }
  if (clipId) {
    const sourceTrack = original.tracks.find((track) => track.segments.some((segment) => segment.id === clipId));
    if (!sourceTrack || sourceSegments.some((segment) => !candidate.tracks.find((track) => track.id === sourceTrack.id)?.segments.includes(segment))) {
      throw new Error("Keep replacement source segments on the selected clip's original track.");
    }
  }
  for (const segment of rootSegments.filter((segment) => !originalSegmentIds.has(segment.id) || segment.id === clipId)) {
    const range = segment.target_timerange;
    if (!Number.isFinite(range.start) || !Number.isFinite(range.duration) || range.duration <= 0 ||
      range.start < start - tolerance || range.start + range.duration > start + duration + tolerance) throw new Error("A new native layer extends outside the selected clip.");
  }
  const originals = new Map(Object.values(original.materials ?? {}).flatMap((items) => Array.isArray(items) ? items.map((item) => [item.id, item] as const) : []));
  const candidateMaterials = new Map(Object.values(candidate.materials).flatMap((items) => Array.isArray(items) ? items.map((item) => [item.id, item] as const) : []));
  const shared = new Set<string>();
  const findReferences = (value: unknown) => {
    if (typeof value === "string" && originals.has(value) && !shared.has(value)) {
      shared.add(value); findReferences(originals.get(value));
    } else if (Array.isArray(value)) value.forEach(findReferences);
    else if (value && typeof value === "object") Object.values(value).forEach(findReferences);
  };
  findReferences(untouched);
  for (const id of shared) if (!isDeepStrictEqual(originals.get(id), candidateMaterials.get(id))) throw new Error("A material used by another clip was changed.");
  const originalMain = original.tracks.find((track) => track.type === "video" && track.flag === 0);
  const sourceOnMain = !clipId || originalMain?.segments.some((segment) => segment.id === clipId);
  for (const track of candidate.tracks.filter((item) => ["effect", "filter"].includes(item.type))) {
    for (const segment of track.segments.filter((item) => !originalSegmentIds.has(item.id))) {
      const material = candidateMaterials.get(segment.material_id);
      const boundToSource = typeof material?.bind_segment_id === "string" && rootSegments.some(segment => segment.id === material.bind_segment_id && (sourceIds.has(segment.id) || !originalSegmentIds.has(segment.id)));
      const range = segment.target_timerange;
      const authorizedComposite = material?.apply_target_type === 2 && !material.bind_segment_id && input.compositionEffectIds?.includes(material.id) &&
        !original.tracks.filter(t => t.type !== 'audio').flatMap(t => t.segments).some(s => !sourceIds.has(s.id) &&
          s.target_timerange.start < range.start + range.duration && s.target_timerange.start + s.target_timerange.duration > range.start);
      if (authorizedComposite) continue;
      if ((!sourceOnMain && !boundToSource) || material?.apply_target_type !== 0 || (material.bind_segment_id && !boundToSource)) throw new Error("Isolate or bind this effect to the edited source; it would affect unrelated layers.");
    }
  }
  for (const draft of children) {
    for (const items of Object.values(draft.materials)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item.draft && item.type === "combination") {
          const child = item.draft as NativeDraft & { id?: string };
          if (!child.id || /[\\/\0]/.test(child.id)) throw new Error("A native compound has no valid child draft ID.");
          const mirrored = JSON.parse(await readFile(join(candidatePath, "subdraft", child.id, "draft_content.json"), "utf8"));
          if (!isDeepStrictEqual(item.draft, mirrored)) throw new Error("The compound's embedded and saved child drafts disagree.");
          await stat(join(candidatePath, "subdraft", child.id, "sub_draft_config.json"));
        }
        if (!item.path || isDeepStrictEqual(originals.get(item.id), item)) continue;
        if (/^https?:/i.test(item.path)) throw new Error("Download native resources locally before attaching them.");
        const path = resolve(candidatePath, item.path.replace(/##_draftpath_placeholder_[^#]+_##/g, candidatePath));
        if (/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(path) && item.extra_type_option !== 2 &&
          !input.sourcePaths.some((source) => resolve(source).toLowerCase() === path.toLowerCase())) {
          throw new Error("A generated video would bake the edit. Keep motion, words and effects as native controls; use only the supplied source footage.");
        }
        if (item.extra_type_option === 2 && !draft.tracks.some(track => track.segments.some(segment => segment.material_id === item.id &&
          segment.extra_material_refs?.some(id => draft.materials.drafts?.some(compound => compound.id === id && compound.type === "combination" && compound.draft)))))
          throw new Error("A compound proxy must reference its editable native child draft.");
        await stat(path).catch(() => { throw new Error(`A native media/effect dependency is missing: ${path}`); });
        const resolved = await realpath(path);
        const roots = [await realpath(candidatePath), await realpath(dirname(input.sourcePaths[0]))];
        if (!roots.some(root => isInside(root, resolved)) && !input.sourcePaths.some(source => resolve(source).toLowerCase() === resolved.toLowerCase()))
          throw new Error("A new dependency is outside this candidate and its job assets.");
      }
    }
  }
}

export async function validateReviewEvidence(review: NativeReview, manifest: NativeManifest, folder: string, digest: string, since: number, hasAudio: boolean) {
  if (!review.matched || !["capcut-preview", "capcut-export"].includes(review.nativeOutput) || !review.endToEnd || !review.nativeControlsChecked || (hasAudio && !review.audioChecked) ||
    review.candidateDigest !== digest || review.mismatches.length || manifest.effects.some((effect) =>
      !review.comparisons.some((item) => item.techniqueId === effect.id && item.matched)) ||
    review.comparisons.some((item) => !item.matched || !Number.isFinite(item.referenceTime) || !Number.isFinite(item.targetTime))) {
    throw new Error(review.mismatches.join("; ") || review.notes || "Native visual comparison is incomplete.");
  }
  const images = [review.openingFrame, review.endingFrame, ...review.comparisons.map((item) => item.previewFrame)];
  if (new Set([review.openingFrame, review.endingFrame]).size !== 2 || images.some((path) => !/\.(png|jpe?g|webp)$/i.test(path)) ||
    !/\.(mp4|mov|mkv|webm)$/i.test(review.playbackPath)) throw new Error("Native opening/ending frames and playback evidence are required.");
  for (const path of [review.playbackPath, ...images]) {
    if (!path || !isInside(folder, path)) throw new Error("Native evidence must be captured in the current review directory.");
    const file = await stat(path);
    if (!file.isFile() || file.size < 100 || file.mtimeMs < since - 2000) throw new Error("Native review evidence is missing or stale.");
  }
}
